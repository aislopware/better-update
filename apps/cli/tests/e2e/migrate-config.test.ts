import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// `migrate-config` does NOT call the server — it is a pure local file transform on
// cwd (apps/cli/src/commands/migrate-config.ts): it merges a legacy eas.json's
// `build`/`submit`/`cli` sections into better-update.json. The harness sets
// process.cwd() to `state.projectDir` for every spawn.
//
// The template below is profiles-FREE so the harness does not pre-write a
// better-update.json `build` section (cli-e2e.ts splitTemplateAndBuildProfiles).
const migrateConfigAppJsonTemplate = {
  expo: {
    name: "Migrate Config App",
    slug: "migrate-config-app",
    owner: "migrate-config",
    version: "1.0.0",
    ios: { bundleIdentifier: "com.example.migrateconfig" },
    android: { package: "com.example.migrateconfig" },
  },
};

const cli = setupCliE2E("e2e-cli-migrate-config", {
  appJsonTemplate: migrateConfigAppJsonTemplate,
  userEmail: "cli-e2e-migrate-config@example.com",
  orgSlug: "cli-e2e-migrate-config-org",
});

// ── Helpers ──────────────────────────────────────────────────────

const easJsonPath = (): string => path.join(cli.getProjectDir(), "eas.json");
const buConfigPath = (): string => path.join(cli.getProjectDir(), "better-update.json");

const readJsonFile = (target: string): unknown =>
  JSON.parse(readFileSync(target, "utf8")) as unknown;

const writeEasJson = (content: unknown): void => {
  writeFileSync(easJsonPath(), `${JSON.stringify(content, null, 2)}\n`);
};

const remove = (target: string): void => {
  if (existsSync(target)) {
    unlinkSync(target);
  }
};

// ── Tests ────────────────────────────────────────────────────────

describe("migrate-config: legacy eas.json → better-update.json", () => {
  it("merges eas.json build/submit into better-update.json (--yes)", () => {
    writeEasJson({ build: { production: { environment: "production" } } });
    remove(buConfigPath());

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Merged eas.json build/submit into better-update.json");

    const config = readJsonFile(buConfigPath()) as { build?: Record<string, unknown> };
    expect(config.build).toStrictEqual({ production: { environment: "production" } });

    remove(easJsonPath());
    remove(buConfigPath());
  });

  it("does nothing when eas.json has no build/submit sections (exit 0)", () => {
    writeEasJson({ cli: { version: "1.0.0" } });
    remove(buConfigPath());

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(0);

    remove(easJsonPath());
    remove(buConfigPath());
  });

  it("errors when no eas.json is present (exit 2)", () => {
    remove(easJsonPath());

    const result = cli.runCli("migrate-config", "--yes");
    expect(result.exitCode).toBe(2);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("No eas.json found at");
  });
});
