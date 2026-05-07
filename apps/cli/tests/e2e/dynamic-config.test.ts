import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// E2E flow against an `app.config.js` (dynamic Expo config) instead of `app.json`.
// Verifies that `@expo/config` resolution works end-to-end: commands that need
// To read projectId/slug from the dynamic config succeed, and `init` surfaces a
// Clear manual-paste hint when the only config file is dynamic.

const cli = setupCliE2E(".wrangler/state/e2e-cli-dynamic", {
  appJsonTemplate: {
    expo: {
      name: "CLI E2E Dynamic App",
      slug: "cli-e2e-dynamic-app",
      owner: "cli-e2e-dynamic",
      version: "1.0.0",
      runtimeVersion: "1.0.0",
      ios: { bundleIdentifier: "com.example.cli.dynamic", buildNumber: "1" },
      android: { package: "com.example.cli.dynamic", versionCode: 1 },
      extra: {
        betterUpdate: {
          profiles: {
            production: {
              environment: "production",
              ios: { distribution: "ad-hoc" },
              android: { distribution: "direct", format: "apk" },
            },
          },
        },
      },
    },
  },
  useDynamicConfig: true,
});

const writeProjectIdIntoDynamicConfig = (projectId: string) => {
  const configPath = path.join(cli.getProjectDir(), "app.config.js");
  const original = readFileSync(configPath, "utf8");
  // Inject extra.betterUpdate.projectId by string-replacing the source so the
  // Dynamic export reflects the linked project. This mimics what a user would
  // Do after seeing the manual-paste hint from `init`.
  const updated = original.replace(
    'betterUpdate": {\n      "profiles":',
    `betterUpdate": {\n      "projectId": "${projectId}",\n      "profiles":`,
  );
  if (updated === original) {
    throw new Error("Failed to inject projectId into app.config.js fixture");
  }
  writeFileSync(configPath, updated);
};

describe("cLI dynamic Expo config (app.config.js)", () => {
  it("init fails with a manual-paste hint when only a dynamic config exists", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("manually");
    expect(result.stderr + result.stdout).toContain("extra: { betterUpdate: { projectId:");
  });

  it("status reads projectId from app.config.js after manual paste", () => {
    writeProjectIdIntoDynamicConfig(cli.getProjectId());

    const result = cli.runCli("status");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CLI E2E Dynamic App");
    expect(result.stdout).toContain("cli-e2e-dynamic-app");
  });

  it("branches list resolves projectId from the dynamic config", () => {
    const result = cli.runCli("branches", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("main");
  });
});
