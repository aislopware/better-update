import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-channels");

// ── Channels API E2E ─────────────────────────────────────────────

describe("Channels API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let branchId: string;
  let channelId: string;
  let secondBranchId: string;
  let apiKeyValue: string;

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Channel E2E User",
      email: "channel-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Channel Org", slug: "channel-org" },
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
      { name: "Channel Test Project", slug: "channel-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    projectId = body.id;
  });

  it("creates a branch", async () => {
    const response = await post("/api/branches", { projectId, name: "main" }, { cookie: cookies });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    branchId = body.id;
  });

  // ── Section 3: Channel CRUD (session auth) ─────────────────────
  // Projects start with 3 seeded channels (production/staging/preview) wired
  // to same-named branches, so all assertions account for that baseline.

  it("creates a channel", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "stable", branchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("branchId");
    expect(body).toHaveProperty("branchMappingJson");
    expect(body).toHaveProperty("cacheVersion");
    expect(body).toHaveProperty("isPaused");
    expect(body).toHaveProperty("createdAt");
    expect(body.name).toBe("stable");
    expect(body.projectId).toBe(projectId);
    expect(body.branchId).toBe(branchId);
    expect(body.isPaused).toBe(false);
    channelId = body.id;
  });

  it("lists channels - channel appears", async () => {
    const response = await get(`/api/channels?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    // 3 seeded + stable
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);
    expect(body.items.map((c: { name: string }) => c.name)).toContain("stable");
  });

  it("paginates channels via page (creates 2nd channel + walks pages, then deletes it)", async () => {
    // Channels enforce unique (project, name); reuse the existing branch.
    const ch2Res = await post(
      "/api/channels",
      { projectId, name: "stable-cursor", branchId },
      { cookie: cookies },
    );
    expect(ch2Res.status).toBe(201);
    const ch2Id = (await ch2Res.json()).id;

    const firstRes = await get(`/api/channels?projectId=${projectId}&limit=2&page=1`, {
      cookie: cookies,
    });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.items).toHaveLength(2);
    // 3 seeded + stable + stable-cursor
    expect(firstBody.total).toBe(5);
    expect(firstBody.page).toBe(1);

    const secondRes = await get(`/api/channels?projectId=${projectId}&limit=2&page=2`, {
      cookie: cookies,
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.page).toBe(2);
    expect(secondBody.items.map((c: { id: string }) => c.id)).not.toEqual(
      firstBody.items.map((c: { id: string }) => c.id),
    );

    // Restore prior state for downstream tests that count channels.
    const cleanup = await del(`/api/channels/${ch2Id}`, { cookie: cookies });
    expect(cleanup.status).toBe(200);
  });

  it("creates a second branch for relink test", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "release" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    secondBranchId = body.id;
  });

  it("relinks channel to second branch", async () => {
    const response = await patch(
      `/api/channels/${channelId}`,
      { branchId: secondBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(channelId);
    expect(body.branchId).toBe(secondBranchId);
    expect(body.name).toBe("stable");
  });

  it("pauses channel", async () => {
    const response = await post(`/api/channels/${channelId}/pause`, {}, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(channelId);
    expect(body.isPaused).toBe(true);
  });

  it("resumes channel", async () => {
    const response = await post(`/api/channels/${channelId}/resume`, {}, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(channelId);
    expect(body.isPaused).toBe(false);
  });

  // ── Section 4: Error cases ─────────────────────────────────────

  it("rejects duplicate channel name (409)", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "stable", branchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects channel with branch from different project (404)", async () => {
    // Create a second project with its own branch
    const projRes = await post(
      "/api/projects",
      { name: "Other Project", slug: "other-proj" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    const otherProjectId = (await projRes.json()).id;

    const branchRes = await post(
      "/api/branches",
      { projectId: otherProjectId, name: "other-main" },
      { cookie: cookies },
    );
    expect(branchRes.status).toBe(201);
    const otherBranchId = (await branchRes.json()).id;

    // Try to create a channel in the first project with a branch from the other project
    const response = await post(
      "/api/channels",
      { projectId, name: "cross-project-channel", branchId: otherBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  // ── Section 5: API key auth ────────────────────────────────────

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "channel-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("lists channels via API key", async () => {
    const response = await get(`/api/channels?projectId=${projectId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // 3 seeded + stable
    expect(body.items).toHaveLength(4);
  });

  it("creates a channel via API key", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "api-key-channel", branchId },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
    expect((await response.json()).name).toBe("api-key-channel");
  });

  // ── Section 6: Cross-org isolation ─────────────────────────────

  let projectIdB: string;
  let branchIdB: string;

  it("creates org B and switches to it", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "channel-org-b" },
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
      { name: "Org B Project", slug: "orgb-channel" },
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
    branchIdB = (await branchRes.json()).id;
  });

  it("creates a channel in org B", async () => {
    const response = await post(
      "/api/channels",
      { projectId: projectIdB, name: "b-channel", branchId: branchIdB },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("org B cannot list channels for org A project (404)", async () => {
    const response = await get(`/api/channels?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("switches back to org A - channels untouched", async () => {
    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const response = await get(`/api/channels?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // 3 seeded + stable + api-key-channel
    expect(body.items).toHaveLength(5);
    expect(body.items.some((c: { name: string }) => c.name === "b-channel")).toBe(false);
  });

  // ── Section 7: Branch rollout ─────────────────────────────────

  let thirdBranchId: string;

  it("creates a third branch for rollout tests", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "rollout-target" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    thirdBranchId = body.id;
  });

  it("creates a branch rollout", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: thirdBranchId, percentage: 10 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(channelId);
    expect(body.branchMappingJson).toBeTruthy();
    const mapping = JSON.parse(body.branchMappingJson);
    expect(mapping.data).toHaveLength(2);
    expect(mapping.data[0].branchId).toBe(thirdBranchId);
    expect(mapping.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.10)");
    expect(mapping.data[1].branchMappingLogic).toBe("true");
    expect(mapping.salt).toBeDefined();
  });

  it("rejects duplicate rollout (409)", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: thirdBranchId, percentage: 20 },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects rollout to current branch (409)", async () => {
    // First revert so we can test the current-branch guard
    const revertRes = await post(
      `/api/channels/${channelId}/rollout/revert`,
      {},
      { cookie: cookies },
    );
    expect(revertRes.status).toBe(200);

    // Now try to rollout to the channel's current branch
    const response = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: secondBranchId, percentage: 10 },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("creates rollout again for update/complete tests", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: thirdBranchId, percentage: 10 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
  });

  it("updates rollout percentage", async () => {
    const response = await patch(
      `/api/channels/${channelId}/rollout`,
      { percentage: 50 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const mapping = JSON.parse(body.branchMappingJson);
    expect(mapping.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.50)");
  });

  it("decreases rollout percentage", async () => {
    const response = await patch(
      `/api/channels/${channelId}/rollout`,
      { percentage: 25 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const mapping = JSON.parse(body.branchMappingJson);
    expect(mapping.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.25)");
  });

  it("rejects update when no active rollout (404)", async () => {
    // Revert first
    const revertRes = await post(
      `/api/channels/${channelId}/rollout/revert`,
      {},
      { cookie: cookies },
    );
    expect(revertRes.status).toBe(200);

    const response = await patch(
      `/api/channels/${channelId}/rollout`,
      { percentage: 30 },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  it("creates rollout again for complete test", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: thirdBranchId, percentage: 80 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
  });

  it("completes rollout - branchId changed, branchMappingJson null", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branchId).toBe(thirdBranchId);
    expect(body.branchMappingJson).toBeNull();
  });

  it("rejects complete when no active rollout (404)", async () => {
    const response = await post(
      `/api/channels/${channelId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  it("creates a second rollout then reverts - branchId unchanged", async () => {
    // Current branchId is thirdBranchId after the complete above
    const createRes = await post(
      `/api/channels/${channelId}/rollout`,
      { newBranchId: branchId, percentage: 25 },
      { cookie: cookies },
    );
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.branchMappingJson).toBeTruthy();

    const response = await post(
      `/api/channels/${channelId}/rollout/revert`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branchId).toBe(thirdBranchId);
    expect(body.branchMappingJson).toBeNull();
  });

  // ── Section 8: Channel deletion ─────────────────────────────────

  it("deletes the channel", async () => {
    const response = await del(`/api/channels/${channelId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);
  });

  it("lists channels - deleted channel is gone", async () => {
    const response = await get(`/api/channels?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.some((c: { id: string }) => c.id === channelId)).toBe(false);
  });

  it("rejects deleting non-existent channel (404)", async () => {
    const response = await del(`/api/channels/${channelId}`, { cookie: cookies });
    expect(response.status).toBe(404);
  });

  it("deletes a channel via API key", async () => {
    // Get the api-key-channel id
    const listRes = await get(`/api/channels?projectId=${projectId}`, { cookie: cookies });
    const listBody = await listRes.json();
    const apiKeyChannel = listBody.items.find(
      (c: { name: string }) => c.name === "api-key-channel",
    );
    expect(apiKeyChannel).toBeDefined();

    const response = await del(`/api/channels/${apiKeyChannel.id}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(1);
  });
});
