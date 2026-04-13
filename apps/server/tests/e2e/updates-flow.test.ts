import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-updates");

// ── Helpers ───────────────────────────────────────────────────────

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, headers ? { headers } : {});

const patch = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const del = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, { method: "DELETE", ...(headers ? { headers } : {}) });

const put = (path: string, body: BodyInit, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    ...(headers ? { headers } : {}),
    body,
  });

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

// ── Updates & Assets API E2E ─────────────────────────────────────

describe("Updates & Assets API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let autoProjectId: string;
  let mainBranchId: string;
  let stagingBranchId: string;
  let productionChannelId: string;
  let updateId: string;
  let stagingUpdateId: string;
  let apiKeyValue: string;

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Updates E2E User",
      email: "updates-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Updates Org", slug: "updates-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
    organizationId = body.id;
    cookies = parseCookies(response) || cookies;
  });

  it("sets the organization as active", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    cookies = parseCookies(response) || cookies;
  });

  // ── Section 2: Prerequisites ───────────────────────────────────

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Updates Test Project", scopeKey: "@updates/test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    projectId = body.id;
  });

  it("creates a project for auto branch/channel creation", async () => {
    const response = await post(
      "/api/projects",
      { name: "Updates Auto Project", scopeKey: "@updates/auto" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    autoProjectId = body.id;
  });

  it("creates main branch", async () => {
    const response = await post("/api/branches", { projectId, name: "main" }, { cookie: cookies });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    mainBranchId = body.id;
  });

  it("creates staging branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "staging" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    stagingBranchId = body.id;
  });

  it("creates production channel linked to main", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "production", branchId: mainBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    productionChannelId = body.id;
  });

  it("creates staging channel linked to staging", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "staging", branchId: stagingBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
  });

  // ── Section 3: Asset upload flow ───────────────────────────────

  it("registers asset metadata", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        assets: [
          { hash: "abc123def456", contentType: "application/javascript", fileExt: "js" },
          { hash: "789abc012def", contentType: "application/javascript", fileExt: "js" },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toContain("abc123def456");
    expect(body.uploaded).toContain("789abc012def");
    expect(body.deduplicated).toHaveLength(0);
  });

  it("uploads first asset binary", async () => {
    const response = await put(
      "/api/assets/abc123def456",
      new TextEncoder().encode("console.log('hello')"),
      { cookie: cookies, "content-type": "application/javascript", "content-length": "20" },
    );
    expect(response.status).toBe(200);
  });

  it("uploads second asset binary", async () => {
    const response = await put(
      "/api/assets/789abc012def",
      new TextEncoder().encode("console.log('world')"),
      { cookie: cookies, "content-type": "application/javascript", "content-length": "20" },
    );
    expect(response.status).toBe(200);
  });

  it("deduplicates already-uploaded assets", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        assets: [
          { hash: "abc123def456", contentType: "application/javascript", fileExt: "js" },
          { hash: "789abc012def", contentType: "application/javascript", fileExt: "js" },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toHaveLength(0);
    expect(body.deduplicated).toContain("abc123def456");
    expect(body.deduplicated).toContain("789abc012def");
  });

  it("auto-creates branch and channel on first publish", async () => {
    const publishResponse = await post(
      "/api/updates",
      {
        project: "@updates/auto",
        branch: "preview-auto",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Auto branch publish",
        groupId: "group-auto-1",
        metadata: {},
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(publishResponse.status).toBe(201);
    const publishBody = await publishResponse.json();
    expect(publishBody.branchId).toBeDefined();

    const branchesResponse = await get(`/api/branches?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(branchesResponse.status).toBe(200);
    const branchesBody = await branchesResponse.json();
    const previewBranch = branchesBody.items.find(
      (branch: { id: string; name: string }) => branch.name === "preview-auto",
    );
    expect(previewBranch).toBeDefined();
    if (!previewBranch) {
      throw new Error("Expected auto-created branch to exist");
    }

    const channelsResponse = await get(`/api/channels?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(channelsResponse.status).toBe(200);
    const channelsBody = await channelsResponse.json();
    const previewChannel = channelsBody.items.find(
      (channel: { name: string; branchId: string }) => channel.name === "preview-auto",
    );
    expect(previewChannel).toBeDefined();
    if (!previewChannel) {
      throw new Error("Expected auto-created channel to exist");
    }
    expect(previewChannel.branchId).toBe(previewBranch.id);
    expect(previewChannel.branchId).toBe(publishBody.branchId);
  });

  it("rejects auto branch creation when the channel name is already linked elsewhere", async () => {
    const conflictingBranchResponse = await post(
      "/api/branches",
      { projectId: autoProjectId, name: "conflict-source" },
      { cookie: cookies },
    );
    expect(conflictingBranchResponse.status).toBe(201);
    const conflictingBranchId = (await conflictingBranchResponse.json()).id as string;

    const conflictingChannelResponse = await post(
      "/api/channels",
      {
        projectId: autoProjectId,
        name: "conflict-preview",
        branchId: conflictingBranchId,
      },
      { cookie: cookies },
    );
    expect(conflictingChannelResponse.status).toBe(201);

    const publishResponse = await post(
      "/api/updates",
      {
        project: "@updates/auto",
        branch: "conflict-preview",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Should not auto-create",
        groupId: "group-auto-conflict",
        metadata: {},
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(publishResponse.status).toBe(409);

    const branchesResponse = await get(`/api/branches?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(branchesResponse.status).toBe(200);
    const branchesBody = await branchesResponse.json();
    expect(
      branchesBody.items.some((branch: { name: string }) => branch.name === "conflict-preview"),
    ).toBe(false);
  });

  // ── Section 4: Update CRUD ─────────────────────────────────────

  it("creates an iOS update", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "main",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Initial release",
        groupId: "group-1",
        metadata: { buildNumber: "42" },
        assets: [
          { hash: "abc123def456", key: "bundles/ios.js", isLaunch: true },
          { hash: "789abc012def", key: "assets/logo.js", isLaunch: false },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("branchId");
    expect(body).toHaveProperty("runtimeVersion");
    expect(body).toHaveProperty("platform");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("groupId");
    expect(body).toHaveProperty("rolloutPercentage");
    expect(body).toHaveProperty("isRollback");
    expect(body).toHaveProperty("createdAt");
    expect(body.runtimeVersion).toBe("1.0.0");
    expect(body.platform).toBe("ios");
    expect(body.message).toBe("Initial release");
    expect(body.groupId).toBe("group-1");
    expect(body.rolloutPercentage).toBe(100);
    expect(body.isRollback).toBe(false);
    updateId = body.id;
  });

  it("creates an Android update in same group", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "main",
        runtimeVersion: "1.0.0",
        platform: "android",
        message: "Initial release",
        groupId: "group-1",
        metadata: { buildNumber: "42" },
        assets: [{ hash: "abc123def456", key: "bundles/android.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("lists updates for project", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it("lists updates filtered by branchId", async () => {
    const response = await get(`/api/updates?projectId=${projectId}&branchId=${mainBranchId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
  });

  // ── Section 5: Rollout operations ──────────────────────────────

  it("edits rollout to 50%", async () => {
    const response = await patch(
      `/api/updates/${updateId}/rollout`,
      { percentage: 50 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(50);
  });

  it("completes rollout", async () => {
    const response = await post(
      `/api/updates/${updateId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("reverts rollout", async () => {
    const response = await post(`/api/updates/${updateId}/rollout/revert`, {}, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(0);
  });

  // ── Section 6: Republish ───────────────────────────────────────

  it("creates an update on staging branch", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "staging",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Staging build",
        groupId: "group-staging",
        metadata: {},
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    stagingUpdateId = body.id;
  });

  it("republishes to production channel", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceUpdateId: stagingUpdateId,
        targetChannelId: productionChannelId,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body.branchId).toBe(mainBranchId);
  });

  // ── Section 7: Delete group ────────────────────────────────────

  it("deletes update group-1", async () => {
    const response = await del(`/api/updates/group-1`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(2);
  });

  it("lists updates - group-1 gone", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // group-1 had 2 updates (ios + android); staging + republished remain
    expect(body.items.every((u: { groupId: string }) => u.groupId !== "group-1")).toBe(true);
  });

  // ── Section 8: API key auth ────────────────────────────────────

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "updates-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("lists updates via API key", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
  });

  it("registers asset metadata via API key", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        assets: [{ hash: "AbCdEf_-123", contentType: "text/plain", fileExt: "txt" }],
      },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toContain("AbCdEf_-123");
  });

  it("uploads asset binary via API key", async () => {
    const response = await put("/api/assets/AbCdEf_-123", new TextEncoder().encode("hello"), {
      authorization: `Bearer ${apiKeyValue}`,
      "content-type": "text/plain",
      "content-length": "5",
    });
    expect(response.status).toBe(200);
  });

  // ── Section 9: Cross-org isolation ─────────────────────────────

  let projectIdB: string;

  it("creates org B and switches to it", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "updates-org-b" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    const orgBId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;
  });

  it("creates a project and branch in org B", async () => {
    const projRes = await post(
      "/api/projects",
      { name: "Org B Project", scopeKey: "@orgb/updates" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectIdB = (await projRes.json()).id;

    const branchRes = await post(
      "/api/branches",
      { projectId: projectIdB, name: "b-main" },
      { cookie: cookies },
    );
    expect(branchRes.status).toBe(201);
  });

  it("org B cannot list updates for org A project (404)", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("switches back to org A - updates untouched", async () => {
    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body.items.every((u: { groupId: string }) => u.groupId !== "group-1")).toBe(true);
  });

  // ── Section 10: Same-runtime publish blocking ─────────────────

  let blockingBranchId: string;
  let blockingUpdateId: string;

  it("creates branch for publish-blocking test", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "blocking-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    blockingBranchId = body.id;
  });

  it("creates channel for publish-blocking test", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "blocking-channel", branchId: blockingBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("creates update with partial rollout (50%)", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "Canary release",
        groupId: "group-blocking-1",
        metadata: {},
        rolloutPercentage: 50,
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(50);
    blockingUpdateId = body.id;
  });

  it("rejects publish to same branch/platform/runtimeVersion during active rollout (409)", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "Should be blocked",
        groupId: "group-blocking-2",
        metadata: {},
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("completes the active rollout", async () => {
    const response = await post(
      `/api/updates/${blockingUpdateId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("allows publish after rollout is completed", async () => {
    const response = await post(
      "/api/updates",
      {
        project: "@updates/test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "After rollout complete",
        groupId: "group-blocking-3",
        metadata: {},
        assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("serializes concurrent rollout publishes on the same branch", async () => {
    const branchResponse = await post(
      "/api/branches",
      { projectId, name: "concurrent-rollout" },
      { cookie: cookies },
    );
    expect(branchResponse.status).toBe(201);
    const concurrentBranchId = (await branchResponse.json()).id as string;

    const [first, second] = await Promise.all([
      post(
        "/api/updates",
        {
          project: "@updates/test",
          branch: "concurrent-rollout",
          runtimeVersion: "3.0.0",
          platform: "ios",
          message: "Concurrent rollout A",
          groupId: "group-concurrent-a",
          metadata: {},
          rolloutPercentage: 50,
          assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
        },
        { cookie: cookies },
      ),
      post(
        "/api/updates",
        {
          project: "@updates/test",
          branch: "concurrent-rollout",
          runtimeVersion: "3.0.0",
          platform: "ios",
          message: "Concurrent rollout B",
          groupId: "group-concurrent-b",
          metadata: {},
          rolloutPercentage: 50,
          assets: [{ hash: "abc123def456", key: "bundles/ios.js", isLaunch: true }],
        },
        { cookie: cookies },
      ),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const updatesResponse = await get(
      `/api/updates?projectId=${projectId}&branchId=${concurrentBranchId}`,
      { cookie: cookies },
    );
    expect(updatesResponse.status).toBe(200);
    const updatesBody = await updatesResponse.json();
    const matching = updatesBody.items.filter(
      (update: { branchId: string; runtimeVersion: string; platform: string }) =>
        update.runtimeVersion === "3.0.0" && update.platform === "ios",
    );
    expect(matching).toHaveLength(1);
  });
});
