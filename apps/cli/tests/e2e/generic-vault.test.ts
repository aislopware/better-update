import { readFileSync } from "node:fs";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// A build-system-neutral (non-Expo) project: no app.json / app.config.js /
// package.json is written into the project dir. The server project's name/slug
// are still derived from this template for setup, but the CLI must resolve the
// project id from BETTER_UPDATE_PROJECT_ID / better-update.json — never Expo.
const cli = setupCliE2E("e2e-cli-generic-vault", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "Generic Vault App", slug: "generic-vault-app" } },
  userEmail: "cli-e2e-generic-vault@example.com",
  orgSlug: "cli-e2e-generic-vault-org",
});

const PROJECT_SLUG = "generic-vault-app";

describe("generic vault: credentials/env on a non-Expo project", () => {
  it("env list resolves the project via BETTER_UPDATE_PROJECT_ID (no app.json)", () => {
    const result = cli.runCliWithEnv(
      { BETTER_UPDATE_PROJECT_ID: cli.getProjectId() },
      "env",
      "list",
    );
    // Resolves + reaches the server (empty list) instead of crashing on @expo/config.
    expect(result.exitCode).toBe(0);
  });

  it("env list without any link source fails with the not-linked guard", () => {
    const result = cli.runCli("env", "list");
    // No env var, no better-update.json yet, no Expo config → ProjectNotLinkedError.
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("BETTER_UPDATE_PROJECT_ID");
  });

  it("credentials list works org-scoped with no project link at all", () => {
    const result = cli.runCli("credentials", "list");
    expect(result.exitCode).toBe(0);
  });

  it("init --name/--slug links a non-Expo project by writing better-update.json", () => {
    const result = cli.runCli("init", "--name", "Generic Vault App", "--slug", PROJECT_SLUG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
    expect(result.stdout).toContain("better-update.json");

    const linkPath = path.join(cli.getProjectDir(), "better-update.json");
    const link = JSON.parse(readFileSync(linkPath, "utf8")) as { projectId?: string };
    expect(link.projectId).toBe(cli.getProjectId());
  });

  it("env list resolves via better-update.json after init (no env var needed)", () => {
    const result = cli.runCli("env", "list");
    expect(result.exitCode).toBe(0);
  });

  it("doctor reports the project as linked via better-update.json", () => {
    const result = cli.runCli("doctor");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked");
    expect(result.stdout).toContain("better-update.json");
  });
});
