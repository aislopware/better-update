import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

const publishAppJsonTemplate = {
  expo: {
    name: "E2E Publish App",
    slug: "e2e-publish-app",
    owner: "e2e-publish",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.e2epublish",
      buildNumber: "1",
    },
    android: {
      package: "com.example.e2epublish",
      versionCode: 1,
    },
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
};

const cli = setupCliE2E("e2e-cli-publish", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: publishAppJsonTemplate,
  userEmail: "cli-e2e-publish@example.com",
  orgSlug: "cli-e2e-publish-org",
});

const publishState = {
  firstGroupId: "",
  firstIosUpdateId: "",
};

// Publish rows are `<platform> <id> <rtv> <uploaded> <reused> <patches>` — the
// trailing Patches column follows Reused, so capture id/uploaded/reused and stop
// before it (a lookahead, not an end anchor).
const iosRowPattern = /^ios\s+([0-9a-f-]+)\s+1\.0\.0\s+(\d+)\s+(\d+)(?=\s|$)/m;
const androidRowPattern = /^android\s+([0-9a-f-]+)\s+1\.0\.0\s+(\d+)\s+(\d+)(?=\s|$)/m;

describe("CLI publish journey", () => {
  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Linking project: E2E Publish App (e2e-publish-app)");
    expect(result.stdout).toContain("Found existing project: E2E Publish App Project");
    expect(result.stdout).toContain("Project linked successfully");

    const appJson = cli.readAppJson();
    const expo = appJson["expo"] as Record<string, unknown>;
    const extra = expo["extra"] as Record<string, unknown>;
    const betterUpdate = extra["betterUpdate"] as Record<string, unknown>;
    expect(betterUpdate["projectId"]).toBe(cli.getProjectId());
  });

  it("publishes an iOS update with fresh assets", () => {
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--allow-dirty",
    );
    expect(result.exitCode).toBe(0);

    const groupMatch = /Published update group ([0-9a-f-]+) to branch "main"\./.exec(result.stdout);
    expect(groupMatch).toBeDefined();
    publishState.firstGroupId = groupMatch![1]!;

    const iosRow = iosRowPattern.exec(result.stdout);
    expect(iosRow).toBeDefined();
    publishState.firstIosUpdateId = iosRow![1]!;

    const uploaded = Number(iosRow![2]);
    const reused = Number(iosRow![3]);
    expect(uploaded).toBeGreaterThan(0);
    expect(reused).toBe(0);
  });

  it("re-publishes iOS and produces a distinct update group", () => {
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--allow-dirty",
    );
    expect(result.exitCode).toBe(0);

    const groupMatch = /Published update group ([0-9a-f-]+) to branch "main"\./.exec(result.stdout);
    expect(groupMatch).toBeDefined();
    expect(groupMatch![1]).not.toBe(publishState.firstGroupId);

    const iosRow = iosRowPattern.exec(result.stdout);
    expect(iosRow).toBeDefined();
    // Hermes bytecode is non-deterministic, so bundle hash changes each export.
    // Verify table structure without asserting exact dedup counts.
    expect(Number(iosRow![2]) + Number(iosRow![3])).toBeGreaterThan(0);
  });

  it("publishes all platforms in a single group", () => {
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "all",
      "--allow-dirty",
    );
    expect(result.exitCode).toBe(0);

    const groupMatch = /Published update group ([0-9a-f-]+) to branch "main"\./.exec(result.stdout);
    expect(groupMatch).toBeDefined();

    const iosRow = iosRowPattern.exec(result.stdout);
    const androidRow = androidRowPattern.exec(result.stdout);
    expect(iosRow).toBeDefined();
    expect(androidRow).toBeDefined();

    // Android first publish should upload at least one asset
    const androidUploaded = Number(androidRow![2]);
    expect(androidUploaded).toBeGreaterThan(0);
  });

  it("publishes with a custom message visible in the API", async () => {
    const customMessage = "Test release v1";
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--message",
      customMessage,
      "--allow-dirty",
    );
    expect(result.exitCode).toBe(0);

    const updatesResponse = await cli.getAuthorized(`/api/updates?projectId=${cli.getProjectId()}`);
    expect(updatesResponse.status).toBe(200);
    const body = (await updatesResponse.json()) as {
      items: { message: string }[];
    };
    expect(body.items).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ message: customMessage })]),
    );
  });

  it("lists all published updates on the branch", () => {
    const result = cli.runCli("update", "list", "--branch", "main");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("No updates found.");
    expect(result.stdout).toContain("main");
    expect(result.stdout).toContain("ios");
    expect(result.stdout).toContain("1.0.0");
    expect(result.stdout).toContain(publishState.firstIosUpdateId);
  });
});
