import { setupE2EWorker } from "../helpers/e2e-worker-pool";
import { seedD1 } from "../helpers/seed-d1";

const { get, parseCookies, post } = setupE2EWorker();

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const runSeedSql = (sql: string) => seedD1(sql);

describe("Build compatibility matrix endpoint", () => {
  let cookies: string;
  let primaryOrgId: string;
  let secondaryOrgId: string;
  let projectId: string;

  it("rejects unauthenticated requests", async () => {
    const response = await get("/api/builds/compatibility-matrix?projectId=missing-project");
    expect(response.status).toBe(401);
  });

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Compatibility E2E User",
      email: "build-compatibility-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates and activates the primary organization", async () => {
    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Compatibility Org", slug: "compatibility-org" },
      { cookie: cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    primaryOrgId = (await createOrgResponse.json()).id;
    cookies = parseCookies(createOrgResponse) || cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: primaryOrgId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;
  });

  it("creates a project and seeds compatibility data", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Compatibility Project", slug: "compatibility-e2e" },
      { cookie: cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    projectId = (await createProjectResponse.json()).id;

    const rolloutMapping = JSON.stringify({
      data: [
        { branchId: "branch-next", branchMappingLogic: "hash_lt(mappingId, 0.50)" },
        { branchId: "branch-main", branchMappingLogic: "true" },
      ],
      salt: "compatibility-salt",
    });

    await runSeedSql(`
-- Project create auto-provisions development/preview/production channels + branches;
-- clear them so the fixed-id topology seeded below is the only one present.
DELETE FROM "channels" WHERE "project_id" = ${sqlString(projectId)};
DELETE FROM "branches" WHERE "project_id" = ${sqlString(projectId)};

INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES
  ('branch-main', ${sqlString(projectId)}, 'main', '2024-01-01T00:00:00Z'),
  ('branch-next', ${sqlString(projectId)}, 'next', '2024-01-02T00:00:00Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at")
VALUES
  ('channel-production', ${sqlString(projectId)}, 'production', 'branch-main', ${sqlString(rolloutMapping)}, 0, 0, '2024-01-03T00:00:00Z');

INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "runtime_version", "app_version", "build_number", "bundle_id", "git_ref", "git_commit", "message", "metadata_json", "created_at")
VALUES
  ('build-old-ios', ${sqlString(projectId)}, 'ios', 'production', 'development', '1.0.0', '1.0.0', '1', 'com.example.old', NULL, NULL, 'Old iOS build', '{}', '2024-01-10T00:00:00Z'),
  ('build-next-ios', ${sqlString(projectId)}, 'ios', 'production', 'development', '2.0.0', '2.0.0', '2', 'com.example.next', NULL, NULL, 'Next iOS build', '{}', '2024-01-11T00:00:00Z'),
  ('build-unmatched-ios', ${sqlString(projectId)}, 'ios', 'production', 'development', '9.9.9', '9.9.9', '3', 'com.example.unmatched', NULL, NULL, 'Unmatched runtime build', '{}', '2024-01-12T00:00:00Z'),
  ('build-zero-ios', ${sqlString(projectId)}, 'ios', 'production', 'development', '6.0.0', '6.0.0', '4', 'com.example.zero', NULL, NULL, 'Zero rollout build', '{}', '2024-01-13T00:00:00Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "created_at")
VALUES
  ('update-old-ios', 'branch-main', '1.0.0', 'ios', 'Old branch release', '{}', NULL, 'group-old-ios', 100, 0, NULL, NULL, NULL, NULL, '2024-01-12T00:00:00Z'),
  ('update-next-ios', 'branch-next', '2.0.0', 'ios', 'Next branch release', '{}', NULL, 'group-next-ios', 100, 0, NULL, NULL, NULL, NULL, '2024-01-13T00:00:00Z'),
  ('update-next-android', 'branch-next', '3.0.0', 'android', 'Next branch native change', '{}', NULL, 'group-next-android', 100, 0, NULL, NULL, NULL, NULL, '2024-01-14T00:00:00Z'),
  ('update-android-stable', 'branch-main', '4.0.0', 'android', 'Android stable', '{}', NULL, 'group-android-stable', 100, 0, NULL, NULL, NULL, NULL, '2024-01-15T00:00:00Z'),
  ('update-android-reverted', 'branch-main', '4.0.0', 'android', 'Android reverted', '{}', NULL, 'group-android-reverted', 0, 0, NULL, NULL, NULL, NULL, '2024-01-16T00:00:00Z'),
  ('update-ios-stable', 'branch-main', '5.0.0', 'ios', 'Stable release', '{}', NULL, 'group-ios-stable', 100, 0, NULL, NULL, NULL, NULL, '2024-01-17T00:00:00Z'),
  ('update-ios-canary', 'branch-main', '5.0.0', 'ios', 'Canary release', '{}', NULL, 'group-ios-canary', 50, 0, NULL, NULL, NULL, NULL, '2024-01-18T00:00:00Z'),
  ('update-zero-ios', 'branch-main', '6.0.0', 'ios', 'Fully reverted', '{}', NULL, 'group-zero-ios', 0, 0, NULL, NULL, NULL, NULL, '2024-01-19T00:00:00Z');
`);
  });

  it("returns servable compatibility summaries across rollouts and fallback updates", async () => {
    const response = await get(`/api/builds/compatibility-matrix?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          isPaused: false,
          rolloutActive: true,
        }),
      ]),
    );

    expect(body.channelStatusByKey).toHaveProperty("ios:2.0.0");
    const productionChannel = body.channels.find(
      (channel: { channelName: string }) => channel.channelName === "production",
    );
    const nextStatus = body.channelStatusByKey["ios:2.0.0"].find(
      (entry: { channelId: string }) => entry.channelId === productionChannel?.channelId,
    );
    expect(nextStatus).toMatchObject({
      updateCount: 1,
      latestUpdateMessage: "Next branch release",
    });

    expect(body.channelStatusByKey).toHaveProperty("ios:1.0.0");

    expect(body.missingRuntimeVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          platform: "android",
          runtimeVersion: "3.0.0",
          updateCount: 1,
          latestUpdateMessage: "Next branch native change",
          rolloutActive: true,
        }),
        expect.objectContaining({
          channelName: "production",
          platform: "android",
          runtimeVersion: "4.0.0",
          updateCount: 1,
          latestUpdateMessage: "Android stable",
          rolloutActive: true,
        }),
        expect.objectContaining({
          channelName: "production",
          platform: "ios",
          runtimeVersion: "5.0.0",
          updateCount: 2,
          latestUpdateMessage: "Canary release",
          rolloutActive: true,
        }),
      ]),
    );
  });

  it("lists compatible builds for a channel with an exact server-side total", async () => {
    // build-old-ios matches via the channel's default branch (branch-main) and
    // build-next-ios via the rollout target (branch-next) — both branches of
    // the active rollout count. build-unmatched-ios (no update for its runtime)
    // and build-zero-ios (its only update has rollout_percentage 0, i.e. not
    // servable) must be excluded from the rows AND the total.
    const response = await get("/api/channels/channel-production/compatible-builds", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      "build-next-ios",
      "build-old-ios",
    ]);
  });

  it("paginates compatible builds newest-first", async () => {
    const firstPage = await get("/api/channels/channel-production/compatible-builds?limit=1", {
      cookie: cookies,
    });
    expect(firstPage.status).toBe(200);
    const firstBody = await firstPage.json();
    expect(firstBody.total).toBe(2);
    expect(firstBody.items.map((item: { id: string }) => item.id)).toEqual(["build-next-ios"]);

    const secondPage = await get(
      "/api/channels/channel-production/compatible-builds?limit=1&page=2",
      { cookie: cookies },
    );
    expect(secondPage.status).toBe(200);
    const secondBody = await secondPage.json();
    expect(secondBody.items.map((item: { id: string }) => item.id)).toEqual(["build-old-ios"]);
  });

  it("returns 404 for compatible builds of an unknown channel", async () => {
    const response = await get("/api/channels/missing-channel/compatible-builds", {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the active organization does not own the project", async () => {
    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Other Compatibility Org", slug: "other-compatibility-org" },
      { cookie: cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    secondaryOrgId = (await createOrgResponse.json()).id;
    cookies = parseCookies(createOrgResponse) || cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: secondaryOrgId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;

    const response = await get(`/api/builds/compatibility-matrix?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);

    const compatibleBuildsResponse = await get(
      "/api/channels/channel-production/compatible-builds",
      { cookie: cookies },
    );
    expect(compatibleBuildsResponse.status).toBe(404);
  });
});
