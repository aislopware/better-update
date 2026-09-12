import {
  expectContains,
  expectIs,
  expectMatches,
  leafCommandPaths,
  makeCliSandbox,
  mapConcurrently,
  parseEnvelope,
} from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

/**
 * Leaves that cannot run to completion inside the sandbox even without auth:
 * `open` launches the system browser, `fingerprint generate` shells out to
 * `bunx @expo/fingerprint` (an npm-registry round-trip — covered by the e2e
 * tier). Their argv parsing is still walked below: a usage error fails before
 * the handler runs.
 */
const NOT_RUNNABLE_IN_SANDBOX: ReadonlySet<string> = new Set(["open", "fingerprint generate"]);

/**
 * Report-style commands whose documented contract is an `ok` envelope AND a
 * non-zero exit: `doctor` prints its check table and exits 6 when any check
 * fails — in the sandbox the server is unreachable, so it always does.
 */
const OK_ENVELOPE_EXIT_CODES: ReadonlyMap<string, number> = new Map([["doctor", 6]]);

const leaves = leafCommandPaths();
const runnableLeaves = leaves.filter(
  (entry) => !NOT_RUNNABLE_IN_SANDBOX.has(entry.tokens.join(" ")),
);

describe("--json contract across every leaf command", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("no args: stdout is empty or exactly one envelope whose command is the dotted path; nothing hangs", async () => {
    const results = await mapConcurrently(runnableLeaves, 12, async (entry) => ({
      entry,
      result: await cli.run(["--json", ...entry.tokens]),
    }));
    for (const { entry, result } of results) {
      const label = entry.tokens.join(" ");
      // A hang here = a prompt or a browser round-trip that ignored --json/CI.
      expectIs(`${label} timed out`, result.timedOut, false);
      if (result.stdout.length === 0) {
        // Nothing on stdout is only legitimate for a usage error (missing
        // required arg/flag → help on stderr) — never a silent success.
        expectIs(`${label}: silent exit`, result.exitCode, 2);
      } else {
        const envelope = parseEnvelope(result.stdout);
        expectIs(label, envelope.command, entry.tokens.join("."));
        if (envelope.ok) {
          expectIs(label, result.exitCode, OK_ENVELOPE_EXIT_CODES.get(label) ?? 0);
        } else {
          expectIs(label, result.exitCode, envelope.error.code);
          expectIs(`${label} tag is mapped`, envelope.error.tag !== "Unknown", true);
        }
      }
    }
  }, 240_000);

  it("unrecognized flag: one UsageError envelope on stdout, help on stderr, exit 2 — for every leaf", async () => {
    const results = await mapConcurrently(leaves, 12, async (entry) => ({
      entry,
      result: await cli.run(["--json", ...entry.tokens, "--definitely-not-a-flag"]),
    }));
    for (const { entry, result } of results) {
      const label = entry.tokens.join(" ");
      expectIs(label, result.exitCode, 2);
      const envelope = parseEnvelope(result.stdout);
      expectMatches(label, envelope, {
        ok: false,
        command: entry.tokens.join("."),
        error: { code: 2, tag: "UsageError" },
      });
      expectContains(label, result.stderr, "USAGE");
      expectContains(label, result.stderr, "--definitely-not-a-flag");
    }
  }, 240_000);
});
