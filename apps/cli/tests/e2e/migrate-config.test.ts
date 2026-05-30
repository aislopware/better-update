import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// `migrate-config` does NOT call the server — it is a pure local file transform on
// cwd (apps/cli/src/commands/migrate-config.ts). The harness sets process.cwd() to
// `state.projectDir` for every spawn, so the command reads/writes app.json + eas.json
// inside `cli.getProjectDir()`. No `init` is needed (init is only for server commands).
//
// Trap: if the appJsonTemplate carries `expo.extra.betterUpdate.profiles` the harness
// pre-strips them and pre-writes its own eas.json (cli-e2e.ts splitTemplateAndEasJson),
// which would defeat every scenario. So the template below is profiles-FREE, and every
// test writes the exact app.json/eas.json fixture it needs directly into getProjectDir().
const migrateConfigAppJsonTemplate = {
  expo: {
    name: "Migrate Config App",
    slug: "migrate-config-app",
    owner: "migrate-config",
    version: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.migrateconfig",
    },
    android: {
      package: "com.example.migrateconfig",
    },
  },
};

const cli = setupCliE2E("e2e-cli-migrate-config", {
  appJsonTemplate: migrateConfigAppJsonTemplate,
  userEmail: "cli-e2e-migrate-config@example.com",
  orgSlug: "cli-e2e-migrate-config-org",
});

// ── Helpers ──────────────────────────────────────────────────────

const appJsonPath = (): string => path.join(cli.getProjectDir(), "app.json");
const easJsonPath = (): string => path.join(cli.getProjectDir(), "eas.json");

const readJsonFile = (target: string): unknown =>
  JSON.parse(readFileSync(target, "utf8")) as unknown;

// Write a fresh app.json for a scenario. Pass `undefined` to omit app.json entirely
// (the no-app.json guard case). Always start every test from a known state so order
// is irrelevant — the no-app.json case deletes the file.
const writeAppJson = (content: unknown): void => {
  if (content === undefined) {
    if (existsSync(appJsonPath())) {
      unlinkSync(appJsonPath());
    }
    return;
  }
  writeFileSync(appJsonPath(), `${JSON.stringify(content, null, 2)}\n`);
};

const removeEasJson = (): void => {
  if (existsSync(easJsonPath())) {
    unlinkSync(easJsonPath());
  }
};

const appWithProfiles = (): unknown => ({
  expo: {
    name: "Migrate Config App",
    slug: "migrate-config-app",
    extra: {
      betterUpdate: {
        projectId: "keep-me",
        profiles: { production: { environment: "production" } },
      },
    },
  },
});

// ── Tests ────────────────────────────────────────────────────────

describe("migrate-config: legacy app.json profiles → eas.json", () => {
  it("migrates profiles into eas.json and strips them from app.json (--yes)", () => {
    writeAppJson(appWithProfiles());
    removeEasJson();

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Migrated profiles into eas.json. Legacy field removed from app.json.",
    );

    // eas.json wraps the migrated profiles under a top-level `build` key.
    const eas = readJsonFile(easJsonPath());
    expect(eas).toStrictEqual({ build: { production: { environment: "production" } } });

    // app.json loses `profiles` but keeps any other betterUpdate fields (projectId).
    const app = readJsonFile(appJsonPath()) as {
      expo?: { extra?: { betterUpdate?: { projectId?: string; profiles?: unknown } } };
    };
    expect(app.expo?.extra?.betterUpdate?.profiles).toBeUndefined();
    expect(app.expo?.extra?.betterUpdate?.projectId).toBe("keep-me");
  });

  it("does nothing when app.json has no legacy profiles (exit 0)", () => {
    writeAppJson({
      expo: {
        name: "Migrate Config App",
        slug: "migrate-config-app",
        extra: { betterUpdate: { projectId: "x-keep" } },
      },
    });
    removeEasJson();

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "No legacy `extra.betterUpdate.profiles` found in app.json — nothing to migrate.",
    );
    // Nothing migrated → no eas.json produced.
    expect(existsSync(easJsonPath())).toBe(false);
  });

  it("refuses to overwrite an existing eas.json (exit 2)", () => {
    writeAppJson(appWithProfiles());
    const sentinel = { build: { staging: { environment: "staging" } } };
    writeFileSync(easJsonPath(), `${JSON.stringify(sentinel, null, 2)}\n`);

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(2);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain(
      "eas.json already exists. Manual review required — refusing to overwrite. Remove eas.json first if you want to regenerate.",
    );
    // Pre-existing eas.json must be left untouched.
    expect(readJsonFile(easJsonPath())).toStrictEqual(sentinel);
    removeEasJson();
  });

  it("errors when no app.json is present (exit 2)", () => {
    writeAppJson(undefined);
    removeEasJson();

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(2);
    // Full message is `No app.json found at <root>.`; the root path is dynamic.
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("No app.json found at");

    // Restore app.json so a re-run of this file from a clean dir is unaffected.
    writeAppJson(appWithProfiles());
  });

  it("prohibits the confirm prompt non-interactively without --yes (exit 2)", () => {
    writeAppJson(appWithProfiles());
    removeEasJson();

    // No --yes → hits promptConfirm. CI=1 (set by harness) makes InteractiveMode.allow
    // false, so ensureInteractive raises InteractiveProhibitedError (exit 2).
    const result = cli.runCli("migrate-config", "--non-interactive");
    expect(result.exitCode).toBe(2);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("Interactive prompt");
    expect(combined).toContain("requested while running non-interactively");

    // Guard fired before any write → no migration happened.
    expect(existsSync(easJsonPath())).toBe(false);
    const app = readJsonFile(appJsonPath()) as {
      expo?: { extra?: { betterUpdate?: { profiles?: unknown } } };
    };
    expect(app.expo?.extra?.betterUpdate?.profiles).toBeDefined();
  });
});
