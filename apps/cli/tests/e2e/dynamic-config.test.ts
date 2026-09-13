import { setupCliE2E } from "../helpers/cli-e2e";

// E2E flow against a dynamic Expo config (`app.config.js` / `app.config.ts`)
// instead of `app.json`, run once per form. Verifies that `@expo/config`
// resolution works end-to-end inside the compiled binary: commands that need
// to read projectId/slug from the dynamic config succeed, and `init` surfaces a
// clear manual-paste hint when the only config file is dynamic.
//
// The fixture's config reads `process.env.BETTER_UPDATE_E2E_PROJECT_ID` to
// decide whether to expose `extra.betterUpdate.projectId` — setting that env
// var simulates the user pasting the projectId into their dynamic config.

const FORMS = ["js", "ts"] as const;

describe.each(FORMS)("CLI dynamic Expo config (app.config.%s)", (form) => {
  const cli = setupCliE2E(`e2e-cli-dynamic-${form}`, {
    userEmail: `cli-e2e-dynamic-${form}@example.com`,
    orgSlug: `cli-e2e-dynamic-${form}-org`,
    appJsonTemplate: {
      expo: {
        name: `CLI E2E Dynamic ${form.toUpperCase()} App`,
        slug: `cli-e2e-dynamic-${form}-app`,
        owner: `cli-e2e-dynamic-${form}`,
        version: "1.0.0",
        runtimeVersion: "1.0.0",
        ios: { bundleIdentifier: `com.example.cli.dynamic.${form}`, buildNumber: "1" },
        android: { package: `com.example.cli.dynamic.${form}`, versionCode: 1 },
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
    useDynamicConfig: form,
  });

  it("init fails with a manual-paste hint when only a dynamic config exists", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("manually");
    expect(result.stderr + result.stdout).toContain("extra: { betterUpdate: { projectId:");
  });

  describe("with linked projectId injected via env", () => {
    beforeAll(() => {
      process.env["BETTER_UPDATE_E2E_PROJECT_ID"] = cli.getProjectId();
    });

    afterAll(() => {
      delete process.env["BETTER_UPDATE_E2E_PROJECT_ID"];
    });

    it(`status reads projectId from app.config.${form}`, () => {
      const result = cli.runCli("status");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`CLI E2E Dynamic ${form.toUpperCase()} App`);
      expect(result.stdout).toContain(`cli-e2e-dynamic-${form}-app`);
    });

    it("branches list resolves projectId from the dynamic config", () => {
      const result = cli.runCli("branches", "list");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("main");
    });
  });
});
