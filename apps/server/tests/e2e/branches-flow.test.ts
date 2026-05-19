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
  // Projects start with 3 seeded branches (production/staging/preview),
  // so all assertions account for that baseline.

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
    expect(body.total).toBe(4);
    expect(body.items.map((b: { name: string }) => b.name)).toContain("main");
  });

  it("renames the branch", async () => {
    const response = await patch(
      `/api/branches/${branchId}`,
      { name: "release" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(branchId);
    expect(body.name).toBe("release");
    expect(body.projectId).toBe(projectId);
    expect(body).toHaveProperty("createdAt");
  });

  it("lists branches - rename persisted", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.items.map((b: { name: string }) => b.name);
    expect(names).toContain("release");
    expect(names).not.toContain("main");
  });

  it("creates a second branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "hotfix" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    expect((await response.json()).name).toBe("hotfix");
  });

  // ── Section 3.5: Page pagination + sort ─────────────────────────

  it("paginates branches via page (limit=2)", async () => {
    const firstRes = await get(`/api/branches?projectId=${projectId}&limit=2&page=1`, {
      cookie: cookies,
    });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.items).toHaveLength(2);
    // 3 seeded + release + hotfix
    expect(firstBody.total).toBe(5);
    expect(firstBody.page).toBe(1);

    const secondRes = await get(`/api/branches?projectId=${projectId}&limit=2&page=2`, {
      cookie: cookies,
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.page).toBe(2);
    expect(secondBody.items.map((b: { id: string }) => b.id)).not.toEqual(
      firstBody.items.map((b: { id: string }) => b.id),
    );
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
      { projectId, name: "hotfix" },
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
      { name: "hotfix" },
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
    // 3 seeded + release + hotfix
    expect(body.items).toHaveLength(5);
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
    // 3 seeded + release + hotfix + api-key-branch
    expect(body.items).toHaveLength(6);
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
    // Use the seeded "staging" branch as the rollout target
    const listRes = await get(`/api/branches?projectId=${projectId}`, { cookie: cookies });
    const listBody = await listRes.json();
    const targetBranch = listBody.items.find((b: { name: string }) => b.name === "staging");
    expect(targetBranch).toBeDefined();

    const rolloutRes = await post(
      `/api/channels/${channelOnBranch}/rollout`,
      { newBranchId: targetBranch.id, percentage: 10 },
      { cookie: cookies },
    );
    expect(rolloutRes.status).toBe(200);

    const deleteRes = await del(`/api/branches/${targetBranch.id}`, { cookie: cookies });
    expect(deleteRes.status).toBe(409);

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
    // 3 seeded + hotfix + api-key-branch (release branch was just deleted)
    expect(body.items).toHaveLength(5);
    expect(body.items.some((b: { id: string }) => b.id === branchId)).toBe(false);
  });

  it("rejects deleting non-existent branch (404)", async () => {
    const response = await del(`/api/branches/${branchId}`, { cookie: cookies });
    expect(response.status).toBe(404);
  });
});
