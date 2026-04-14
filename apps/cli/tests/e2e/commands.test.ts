import { setupCliE2E } from "../helpers/cli-e2e";

const cli = setupCliE2E(".wrangler/state/e2e-cli");

describe("CLI command journey", () => {
  it("links the current Expo app to the existing project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Linking project: CLI E2E App (@cli-e2e/cli-e2e-app)");
    expect(result.stdout).toContain("Found existing project: CLI Linked Project");
    expect(result.stdout).toContain("Project linked successfully");

    const appJson = cli.readAppJson();
    expect(
      (
        ((appJson["expo"] as Record<string, unknown>)["extra"] as Record<string, unknown>)[
          "betterUpdate"
        ] as Record<string, unknown>
      )["projectId"],
    ).toBe(cli.getProjectId());
  });

  it("shows project status with credential and build counts", () => {
    const result = cli.runCli("status");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Project");
    expect(result.stdout).toContain("CLI Linked Project");
    expect(result.stdout).toContain("@cli-e2e/cli-e2e-app");
    expect(result.stdout).toContain("Credentials");
    expect(result.stdout).toContain("iOS");
    expect(result.stdout).toContain("1");
    expect(result.stdout).toContain("Builds");
  });

  it("lists credentials for the linked project", () => {
    const result = cli.runCli("credentials", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("CLI iOS Distribution Certificate");
    expect(result.stdout).toContain("distribution-certificate");
    expect(result.stdout).toContain("ios");
  });

  it("lists environment variables with masked secret values", () => {
    const result = cli.runCli("env", "list", "--environment", "production");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("APP_SECRET");
    expect(result.stdout).toContain("production");
    expect(result.stdout).toContain("secret");
    expect(result.stdout).toContain("••••••");
  });

  it("lists builds for the linked project", () => {
    const result = cli.runCli("builds");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("cli-build-1");
    expect(result.stdout).toContain("ad-hoc");
    expect(result.stdout).toContain("production");
  });

  it("creates a rollback update from the CLI", async () => {
    const commitTime = "2026-04-14T00:00:00.000Z";
    const rollbackResult = cli.runCli(
      "update",
      "rollback",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--commit-time",
      commitTime,
    );

    expect(rollbackResult.exitCode).toBe(0);
    expect(rollbackResult.stderr).toBe("");
    expect(rollbackResult.stdout).toContain("Created rollback group");
    expect(rollbackResult.stdout).toContain('on branch "main"');
    expect(rollbackResult.stdout).toContain(commitTime);

    const listResult = cli.runCli("update", "list", "--branch", "main");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stderr).toBe("");
    expect(listResult.stdout).toContain("Update ID");
    expect(listResult.stdout).toContain("main");
    expect(listResult.stdout).toContain("ios");
    expect(listResult.stdout).toContain("1.0.0");
    expect(listResult.stdout).toContain("yes");

    const response = await cli.getAuthorized(`/api/updates?projectId=${cli.getProjectId()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: expect.any(String),
          isRollback: true,
          platform: "ios",
          runtimeVersion: "1.0.0",
          rolloutPercentage: 100,
        }),
      ]),
    );
  });
});
