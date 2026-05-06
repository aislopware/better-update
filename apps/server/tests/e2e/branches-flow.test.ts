import { setupE2EWorker } from "../helpers/e2e-worker";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-branches");

// ── Branches API E2E ─────────────────────────────────────────────

describe("Branches API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let branchId: string;
  let apiKeyValue: string;

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Branch E2E User",
      email: "branch-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Branch Org", slug: "branch-org" },
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

  // ── Section 2: Project prerequisite ────────────────────────────

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Branch Test Project", slug: "branch-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    projectId = body.id;
  });

  // ── Section 3: Branch CRUD (session auth) ──────────────────────

  it("creates a branch", async () => {
    const response = await post("/api/branches", { projectId, name: "main" }, { cookie: cookies });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("createdAt");
    expect(body.name).toBe("main");
    expect(body.projectId).toBe(projectId);
    branchId = body.id;
  });

  it("lists branches - branch appears", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("main");
  });

  it("renames the branch", async () => {
    const response = await patch(
      `/api/branches/${branchId}`,
      { name: "production" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(branchId);
    expect(body.name).toBe("production");
    expect(body.projectId).toBe(projectId);
    expect(body).toHaveProperty("createdAt");
  });

  it("lists branches - rename persisted", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("production");
  });

  it("creates a second branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "staging" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    expect((await response.json()).name).toBe("staging");
  });

  // ── Section 3.5: Page pagination + sort ─────────────────────────

  it("paginates branches via page (limit=1)", async () => {
    const firstRes = await get(`/api/branches?projectId=${projectId}&limit=1&page=1`, {
      cookie: cookies,
    });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.total).toBe(2);
    expect(firstBody.page).toBe(1);

    const secondRes = await get(`/api/branches?projectId=${projectId}&limit=1&page=2`, {
      cookie: cookies,
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.page).toBe(2);
    expect(secondBody.items[0].id).not.toBe(firstBody.items[0].id);
  });

  it("sorts branches by name ascending", async () => {
    const response = await get(`/api/branches?projectId=${projectId}&sort=name`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.items.map((b: { name: string }) => b.name);
    expect(names).toStrictEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  // ── Section 4: Error cases ─────────────────────────────────────

  it("rejects duplicate branch name (409)", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "staging" },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects branch creation for non-existent project (404)", async () => {
    const response = await post(
      "/api/branches",
      { projectId: "00000000-0000-0000-0000-000000000000", name: "ghost" },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  it("rejects rename to duplicate name (409)", async () => {
    const response = await patch(
      `/api/branches/${branchId}`,
      { name: "staging" },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  // ── Section 5: API key auth ────────────────────────────────────

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "branch-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("lists branches via API key", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
  });

  it("creates a branch via API key", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "api-key-branch" },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
    expect((await response.json()).name).toBe("api-key-branch");
  });

  // ── Section 6: Cross-org isolation ─────────────────────────────

  let projectIdB: string;

  it("creates org B and switches to it", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "org-b" },
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

  it("creates a project in org B", async () => {
    const response = await post(
      "/api/projects",
      { name: "Org B Project", slug: "orgb-app" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    projectIdB = (await response.json()).id;
  });

  it("org B cannot list branches for org A project (404)", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("creates a branch in org B project", async () => {
    const response = await post(
      "/api/branches",
      { projectId: projectIdB, name: "b-branch" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("switches back to org A - branches untouched", async () => {
    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(3);
    expect(body.items.some((b: { name: string }) => b.name === "b-branch")).toBe(false);
  });

  // ── Section 7: Branch deletion ──────────────────────────────────

  let channelOnBranch: string;

  it("creates a channel linked to the branch (for conflict test)", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "linked-channel", branchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    channelOnBranch = (await response.json()).id;
  });

  it("rejects branch delete while channels are linked (409)", async () => {
    const response = await del(`/api/branches/${branchId}`, { cookie: cookies });
    expect(response.status).toBe(409);
  });

  it("rejects deleting a branch that is a rollout target (409)", async () => {
    // Get the staging branch ID
    const listRes = await get(`/api/branches?projectId=${projectId}`, { cookie: cookies });
    const listBody = await listRes.json();
    const stagingBranch = listBody.items.find((b: { name: string }) => b.name === "staging");
    expect(stagingBranch).toBeDefined();

    // Start a rollout from channelOnBranch to staging
    const rolloutRes = await post(
      `/api/channels/${channelOnBranch}/rollout`,
      { newBranchId: stagingBranch.id, percentage: 10 },
      { cookie: cookies },
    );
    expect(rolloutRes.status).toBe(200);

    // Try to delete staging — should be blocked because it's a rollout target
    const deleteRes = await del(`/api/branches/${stagingBranch.id}`, { cookie: cookies });
    expect(deleteRes.status).toBe(409);

    // Clean up: revert the rollout
    const revertRes = await post(
      `/api/channels/${channelOnBranch}/rollout/revert`,
      {},
      { cookie: cookies },
    );
    expect(revertRes.status).toBe(200);
  });

  it("deletes the linked channel first", async () => {
    const response = await del(`/api/channels/${channelOnBranch}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);
  });

  it("deletes the branch after unlinking", async () => {
    const response = await del(`/api/branches/${branchId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);
  });

  it("lists branches - deleted branch is gone", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.some((b: { id: string }) => b.id === branchId)).toBe(false);
  });

  it("rejects deleting non-existent branch (404)", async () => {
    const response = await del(`/api/branches/${branchId}`, { cookie: cookies });
    expect(response.status).toBe(404);
  });
});
