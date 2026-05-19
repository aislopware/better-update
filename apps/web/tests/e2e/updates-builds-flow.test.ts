import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, patch, parseCookies, seedSql } = setupE2EDashboard();

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

describe("dashboard updates and builds flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    mainBranchId: "",
    nextBranchId: "",
    channelId: "",
  };

  it("registers a user and activates an organization", async () => {
    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "Dashboard Updates User",
      email: "dashboard-updates@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    state.cookies = parseCookies(signUpResponse);

    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Dashboard Updates Org", slug: "dashboard-updates-org" },
      { cookie: state.cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    const createOrgBody = await createOrgResponse.json();
    state.organizationId = createOrgBody.id;
    state.cookies = parseCookies(createOrgResponse) || state.cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    state.cookies = parseCookies(setActiveResponse) || state.cookies;
  });

  it("creates project, branches, channel, and starts a rollout", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Dashboard OTA Project", slug: "dashboard-ota" },
      { cookie: state.cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    const createProjectBody = await createProjectResponse.json();
    state.projectId = createProjectBody.id;

    const createMainBranchResponse = await post(
      "/api/branches",
      { projectId: state.projectId, name: "main" },
      { cookie: state.cookies },
    );
    expect(createMainBranchResponse.status).toBe(201);
    const createMainBranchBody = await createMainBranchResponse.json();
    state.mainBranchId = createMainBranchBody.id;

    const createNextBranchResponse = await post(
      "/api/branches",
      { projectId: state.projectId, name: "next" },
      { cookie: state.cookies },
    );
    expect(createNextBranchResponse.status).toBe(201);
    const createNextBranchBody = await createNextBranchResponse.json();
    state.nextBranchId = createNextBranchBody.id;

    // The seeded "production" channel ships with the project; relink it to
    // the main branch so the rollout test below operates on it.
    const listChannelsResponse = await get(`/api/channels?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(listChannelsResponse.status).toBe(200);
    const listChannelsBody = await listChannelsResponse.json();
    const productionChannel = listChannelsBody.items.find(
      (item: { name: string }) => item.name === "production",
    );
    expect(productionChannel).toBeDefined();
    state.channelId = productionChannel.id;

    const rebindChannelResponse = await patch(
      `/api/channels/${state.channelId}`,
      { branchId: state.mainBranchId },
      { cookie: state.cookies },
    );
    expect(rebindChannelResponse.status).toBe(200);

    const createRolloutResponse = await post(
      `/api/channels/${state.channelId}/rollout`,
      { newBranchId: state.nextBranchId, percentage: 25 },
      { cookie: state.cookies },
    );
    expect(createRolloutResponse.status).toBe(200);
  });

  it("surfaces compatibility matrix and install links through dashboard proxy", async () => {
    seedSql(`
INSERT INTO "builds" (
  "id", "project_id", "platform", "profile", "distribution", "runtime_version",
  "app_version", "build_number", "bundle_id", "git_ref", "git_commit",
  "message", "metadata_json", "created_at"
)
VALUES
  ('dash-build-main', ${sqlString(state.projectId)}, 'ios', 'production', 'ad-hoc', '1.0.0', '1.0.0', '1', 'com.dashboard.app', 'main', 'abc1234', 'Dashboard stable build', '{}', '2024-01-10T00:00:00Z'),
  ('dash-build-next', ${sqlString(state.projectId)}, 'ios', 'production', 'ad-hoc', '2.0.0', '2.0.0', '2', 'com.dashboard.app', 'next', 'def5678', 'Dashboard next build', '{}', '2024-01-11T00:00:00Z');

INSERT INTO "build_artifacts" (
  "build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at"
)
VALUES
  ('dash-build-main', 'builds/${state.organizationId}/${state.projectId}/dash-build-main.ipa', 'ipa', 'application/octet-stream', 1024, 'main-sha', '2024-01-10T00:00:00Z'),
  ('dash-build-next', 'builds/${state.organizationId}/${state.projectId}/dash-build-next.ipa', 'ipa', 'application/octet-stream', 2048, 'next-sha', '2024-01-11T00:00:00Z');

INSERT INTO "updates" (
  "id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json",
  "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain",
  "manifest_body", "directive_body", "created_at"
)
VALUES
  ('dash-update-stable-old', ${sqlString(state.mainBranchId)}, '1.0.0', 'ios', 'Stable old', '{}', NULL, 'group-stable-old', 100, 0, NULL, NULL, NULL, NULL, '2024-01-12T00:00:00Z'),
  ('dash-update-stable-current', ${sqlString(state.mainBranchId)}, '1.0.0', 'ios', 'Stable current', '{}', NULL, 'group-stable-current', 100, 0, NULL, NULL, NULL, NULL, '2024-01-13T00:00:00Z'),
  ('dash-update-next', ${sqlString(state.nextBranchId)}, '2.0.0', 'ios', 'Next release', '{}', NULL, 'group-next', 100, 0, NULL, NULL, NULL, NULL, '2024-01-14T00:00:00Z'),
  ('dash-update-next-android', ${sqlString(state.nextBranchId)}, '3.0.0', 'android', 'Android next release', '{}', NULL, 'group-next-android', 100, 0, NULL, NULL, NULL, NULL, '2024-01-15T00:00:00Z');
`);

    const compatibilityResponse = await get(
      `/api/builds/compatibility-matrix?projectId=${state.projectId}`,
      { cookie: state.cookies },
    );
    expect(compatibilityResponse.status).toBe(200);
    const compatibilityBody = await compatibilityResponse.json();
    expect(compatibilityBody.channels).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          rolloutActive: true,
        }),
      ]),
    );
    const productionChannelId = compatibilityBody.channels.find(
      (channel: { channelName: string }) => channel.channelName === "production",
    )?.channelId;
    expect(compatibilityBody.channelStatusByKey).toHaveProperty("ios:2.0.0");
    expect(
      compatibilityBody.channelStatusByKey["ios:2.0.0"].find(
        (entry: { channelId: string }) => entry.channelId === productionChannelId,
      ),
    ).toMatchObject({
      latestUpdateMessage: "Next release",
      updateCount: 1,
    });
    expect(compatibilityBody.missingRuntimeVersions).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          platform: "android",
          runtimeVersion: "3.0.0",
          rolloutActive: true,
        }),
      ]),
    );

    const installLinkResponse = await get(`/api/builds/dash-build-next/install-link`, {
      cookie: state.cookies,
    });
    expect(installLinkResponse.status).toBe(200);
    const installLinkBody = await installLinkResponse.json();
    expect(installLinkBody).toStrictEqual(
      expect.objectContaining({
        artifactUrl: expect.stringContaining("/api/builds/dash-build-next/artifact?token="),
        installUrl: expect.stringContaining("itms-services://?action=download-manifest"),
      }),
    );
  });

  it("updates and reverts a branch rollout, then creates and edits a rollback update", async () => {
    const updateRolloutResponse = await patch(
      `/api/channels/${state.channelId}/rollout`,
      { percentage: 50 },
      { cookie: state.cookies },
    );
    expect(updateRolloutResponse.status).toBe(200);

    const revertRolloutResponse = await post(
      `/api/channels/${state.channelId}/rollout/revert`,
      {},
      { cookie: state.cookies },
    );
    expect(revertRolloutResponse.status).toBe(200);

    const createRollbackResponse = await post(
      "/api/updates",
      {
        branch: "main",
        slug: "dashboard-ota",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Rollback to embedded",
        groupId: "dashboard-rollback-group",
        metadata: {},
        assets: [],
        isRollback: true,
        directiveBody: JSON.stringify({
          type: "rollBackToEmbedded",
          parameters: {
            commitTime: "2026-04-14T00:00:00.000Z",
          },
        }),
      },
      { cookie: state.cookies },
    );
    expect(createRollbackResponse.status).toBe(201);

    const editUpdateRolloutResponse = await patch(
      "/api/updates/dash-update-stable-current/rollout",
      { percentage: 25 },
      { cookie: state.cookies },
    );
    expect(editUpdateRolloutResponse.status).toBe(200);
    const editUpdateRolloutBody = await editUpdateRolloutResponse.json();
    expect(editUpdateRolloutBody).toStrictEqual(
      expect.objectContaining({
        id: "dash-update-stable-current",
        rolloutPercentage: 25,
      }),
    );

    const completeUpdateRolloutResponse = await post(
      "/api/updates/dash-update-stable-current/rollout/complete",
      {},
      { cookie: state.cookies },
    );
    expect(completeUpdateRolloutResponse.status).toBe(200);
    const completeUpdateRolloutBody = await completeUpdateRolloutResponse.json();
    expect(completeUpdateRolloutBody).toStrictEqual(
      expect.objectContaining({
        id: "dash-update-stable-current",
        rolloutPercentage: 100,
      }),
    );
  });
});
