import { setupCliE2E } from "../helpers/cli-e2e";

// E2E flow against an `app.config.js` (dynamic Expo config) instead of `app.json`.
// Verifies that `@expo/config` resolution works end-to-end: commands that need
// to read projectId/slug from the dynamic config succeed, and `init` surfaces a
// clear manual-paste hint when the only config file is dynamic.
//
// The fixture's `app.config.js` reads `process.env.BETTER_UPDATE_E2E_PROJECT_ID`
// to decide whether to expose `extra.betterUpdate.projectId` — setting that env
// var simulates the user pasting the projectId into their dynamic config.

const PROJECT_ID_ENV_KEY = "BETTER_UPDATE_E2E_PROJECT_ID";

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

describe("CLI dynamic Expo config (app.config.js)", () => {
  it("init fails with a manual-paste hint when only a dynamic config exists", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("manually");
    expect(result.stderr + result.stdout).toContain("extra: { betterUpdate: { projectId:");
  });

  describe("with linked projectId injected via env", () => {
    beforeAll(() => {
      process.env[PROJECT_ID_ENV_KEY] = cli.getProjectId();
    });

    afterAll(() => {
      delete process.env["BETTER_UPDATE_E2E_PROJECT_ID"];
    });

    it("status reads projectId from app.config.js", () => {
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
});
