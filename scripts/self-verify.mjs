#!/usr/bin/env node
// Autonomous self-verification orchestrator.
//
// Runs every test tier that can execute headlessly — lint/typecheck, unit,
// server integration, and the full end-to-end suites (server pool + remote-R2,
// CLI, web) — captures each tier's exit code, duration, and full log to
// `.self-verify/`, then writes a machine-readable `summary.json` and prints a
// table. Designed to be launched in the background (`bun run verify &`) so an
// agent (or CI) never foreground-blocks on the slow suites: poll/read
// `.self-verify/summary.json` when the process exits.
//
// Why this exists: every e2e suite here is actually autonomous. The server
// `e2e-pool`, CLI, and web suites boot a local worker (`unstable_startWorker` /
// vitest-pool-workers) against local D1/R2 — no Cloudflare auth. The lone
// remote suite (`e2e-pool-r2`, the direct-upload checksum contract) reaches
// real R2 via an API token read from `apps/server/.env.local` (E2E_*), never an
// interactive `wrangler login`. The only genuinely human-only tier is the CLI
// `slow` suite (a real Android Gradle build needing the Android SDK), excluded
// by default.
//
// Usage:
//   node scripts/self-verify.mjs                # full gate (all autonomous tiers)
//   node scripts/self-verify.mjs --only=e2e     # only the e2e tiers
//   node scripts/self-verify.mjs --tiers=a,b    # explicit tier ids (see --list)
//   node scripts/self-verify.mjs --list         # print tier ids and exit
//   node scripts/self-verify.mjs --include-slow # also run the human-only Android tier

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, ".self-verify");
const SERVER_DIR = path.join(ROOT, "apps/server");
const CLI_DIR = path.join(ROOT, "apps/cli");
const WEB_DIR = path.join(ROOT, "apps/web");

// `e2e-pool-r2` only runs when the remote-R2 API-token creds are present in
// apps/server/.env.local; otherwise it is SKIPPED (not failed), so the gate
// stays green on a machine without the e2e Cloudflare bucket configured.
const hasRemoteR2Creds = () => {
  const envFile = path.join(SERVER_DIR, ".env.local");
  if (!existsSync(envFile)) {
    return false;
  }
  const text = readFileSync(envFile, "utf8");
  const filled = (key) => new RegExp(`^${key}=.+`, "m").test(text);
  return filled("E2E_CF_ACCOUNT_ID") && filled("E2E_CLOUDFLARE_API_TOKEN");
};

/**
 * @typedef {object} Tier
 * @property {string} id        short identifier (used by --tiers / --list)
 * @property {string} label     human description
 * @property {string} group     "static" | "unit" | "integration" | "e2e"
 * @property {string} cwd       working directory
 * @property {string[]} cmd     argv (cmd[0] is the binary)
 * @property {boolean} [humanOnly]   excluded unless --include-slow
 * @property {() => boolean} [skipIf] when true, the tier is SKIPPED, not run
 * @property {string} [skipReason]   shown when skipIf fires
 */

/** @type {Tier[]} */
const TIERS = [
  {
    id: "lint",
    label: "Lint + typecheck (oxlint + tsgolint, all packages)",
    group: "static",
    cwd: ROOT,
    cmd: ["bun", "run", "lint"],
  },
  {
    id: "unit",
    label: "Unit tests (all apps + packages, via turbo)",
    group: "unit",
    cwd: ROOT,
    cmd: ["bun", "run", "test"],
  },
  {
    id: "integration",
    label: "Server integration (Workers runtime, local D1/R2)",
    group: "integration",
    cwd: SERVER_DIR,
    cmd: ["bun", "run", "test:integrations"],
  },
  {
    id: "e2e-server",
    label: "Server e2e — pure-API flows (local D1/R2, no auth)",
    group: "e2e",
    cwd: SERVER_DIR,
    cmd: ["bun", "run", "test:e2e-pool"],
  },
  {
    id: "e2e-server-r2",
    label: "Server e2e — direct-upload checksum contract (real R2 via .env.local token)",
    group: "e2e",
    cwd: SERVER_DIR,
    cmd: ["bun", "run", "test:e2e-r2"],
    skipIf: () => !hasRemoteR2Creds(),
    skipReason: "no E2E_CF_ACCOUNT_ID / E2E_CLOUDFLARE_API_TOKEN in apps/server/.env.local",
  },
  {
    id: "e2e-cli",
    label: "CLI e2e — publish/rollout/rollback/env/codesign (real expo export + local worker)",
    group: "e2e",
    cwd: CLI_DIR,
    cmd: ["bun", "run", "test:e2e"],
  },
  {
    id: "e2e-web",
    label: "Web e2e — API + browser (local worker + vite + chromium)",
    group: "e2e",
    cwd: WEB_DIR,
    cmd: ["bun", "run", "test:e2e"],
  },
  {
    id: "cli-slow",
    label: "CLI slow — real Android Gradle build (needs Android SDK)",
    group: "e2e",
    cwd: CLI_DIR,
    cmd: ["bun", "run", "test:slow"],
    humanOnly: true,
  },
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

if (flag("list")) {
  for (const tier of TIERS) {
    const tags = [tier.group, tier.humanOnly ? "human-only" : ""].filter(Boolean).join(", ");
    process.stdout.write(`${tier.id.padEnd(16)} ${tier.label}  [${tags}]\n`);
  }
  process.exit(0);
}

const onlyGroup = value("only"); // e.g. "e2e"
const tierFilter = value("tiers")
  ?.split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const includeSlow = flag("include-slow");

const selected = TIERS.filter((tier) => {
  if (tier.humanOnly && !includeSlow) {
    return false;
  }
  if (tierFilter) {
    return tierFilter.includes(tier.id);
  }
  if (onlyGroup) {
    return tier.group === onlyGroup;
  }
  return true;
});

if (selected.length === 0) {
  process.stderr.write("No tiers selected. Try --list.\n");
  process.exit(2);
}

// ── Run ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const fmtMs = (ms) => {
  const s = Math.round(ms / 100) / 10;
  return s >= 60
    ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`
    : `${s}s`;
};

const startedAt = new Date().toISOString();
const results = [];

process.stdout.write(`\nself-verify · ${selected.length} tier(s) · ${startedAt}\n\n`);

for (const tier of selected) {
  if (tier.skipIf?.()) {
    process.stdout.write(`SKIP  ${tier.id.padEnd(16)} (${tier.skipReason})\n`);
    results.push({ id: tier.id, label: tier.label, status: "skipped", reason: tier.skipReason });
    continue;
  }

  const logPath = path.join(OUT_DIR, `${tier.id}.log`);
  const fd = openSync(logPath, "w");
  process.stdout.write(
    `RUN   ${tier.id.padEnd(16)} ${tier.cmd.join(" ")}  → ${path.relative(ROOT, logPath)}\n`,
  );
  const t0 = Date.now();
  // Stream child stdout+stderr straight to the log fd (no in-memory buffering of
  // multi-MB vitest output). CI=1 + NO_COLOR keep prompts non-interactive and
  // logs grep-friendly.
  const proc = spawnSync(tier.cmd[0], tier.cmd.slice(1), {
    cwd: tier.cwd,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  closeSync(fd);
  const durationMs = Date.now() - t0;

  const exitCode = proc.status ?? (proc.signal ? 1 : 1);
  const status = exitCode === 0 ? "passed" : "failed";
  process.stdout.write(
    `${status === "passed" ? "PASS" : "FAIL"}  ${tier.id.padEnd(16)} ${fmtMs(durationMs)} (exit ${exitCode})\n`,
  );
  results.push({
    id: tier.id,
    label: tier.label,
    status,
    exitCode,
    durationMs,
    log: path.relative(ROOT, logPath),
    ...(proc.signal ? { signal: proc.signal } : {}),
  });
}

const finishedAt = new Date().toISOString();
const failed = results.filter((r) => r.status === "failed");
const passed = results.filter((r) => r.status === "passed");
const skipped = results.filter((r) => r.status === "skipped");

const summary = {
  startedAt,
  finishedAt,
  totals: { passed: passed.length, failed: failed.length, skipped: skipped.length },
  ok: failed.length === 0,
  results,
};
writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

process.stdout.write(`\n${"─".repeat(60)}\n`);
process.stdout.write(
  `passed ${passed.length}  failed ${failed.length}  skipped ${skipped.length}\n`,
);
if (failed.length > 0) {
  process.stdout.write(`\nFAILED tiers (see logs):\n`);
  for (const r of failed) {
    process.stdout.write(`  ${r.id} → ${r.log}\n`);
  }
}
process.stdout.write(`summary → ${path.relative(ROOT, path.join(OUT_DIR, "summary.json"))}\n`);

process.exit(failed.length === 0 ? 0 : 1);
