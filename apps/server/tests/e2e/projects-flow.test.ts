import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-projects");

// ── Projects API E2E ─────────────────────────────────────────────

describe("Projects API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Project E2E User",
      email: "project-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Project Org", slug: "project-org" },
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

  // ── Section 2: Project CRUD ────────────────────────────────────

  it("creates a project with default branches + channels seeded", async () => {
    const response = await post(
      "/api/projects",
      { name: "My Project", slug: "my-project" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("organizationId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("slug");
    expect(body).toHaveProperty("createdAt");
    expect(body.name).toBe("My Project");
    expect(body.slug).toBe("my-project");
    expect(body.branchCount).toBe(3);
    expect(body.channelCount).toBe(3);
    expect(body.updateCount).toBe(0);
    projectId = body.id;
  });

  it("seeds production/staging/preview branches on create", async () => {
    const response = await get(`/api/branches?projectId=${projectId}&sort=name`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.items.map((b: { name: string }) => b.name)).toEqual([
      "preview",
      "production",
      "staging",
    ]);
  });

  it("seeds production/staging/preview channels pointing at matching branches", async () => {
    const channelsRes = await get(`/api/channels?projectId=${projectId}&sort=name`, {
      cookie: cookies,
    });
    expect(channelsRes.status).toBe(200);
    const channelsBody = await channelsRes.json();
    expect(channelsBody.total).toBe(3);
    expect(channelsBody.items.map((c: { name: string }) => c.name)).toEqual([
      "preview",
      "production",
      "staging",
    ]);

    const branchesRes = await get(`/api/branches?projectId=${projectId}&sort=name`, {
      cookie: cookies,
    });
    const branchesBody = await branchesRes.json();
    const branchByName = new Map<string, string>(
      branchesBody.items.map((b: { id: string; name: string }) => [b.name, b.id]),
    );
    for (const channel of channelsBody.items as readonly { name: string; branchId: string }[]) {
      expect(channel.branchId).toBe(branchByName.get(channel.name));
    }
  });

  it("gets the project by id", async () => {
    const response = await get(`/api/projects/${projectId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(projectId);
    expect(body.name).toBe("My Project");
    expect(body.slug).toBe("my-project");
    expect(body).toHaveProperty("organizationId");
    expect(body).toHaveProperty("createdAt");
  });

  it("renames the project", async () => {
    const response = await patch(
      `/api/projects/${projectId}`,
      { name: "New Name" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(projectId);
    expect(body.name).toBe("New Name");
    expect(body.slug).toBe("my-project");
    expect(body).toHaveProperty("createdAt");
  });

  it("lists projects - rename persisted", async () => {
    const response = await get("/api/projects", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("New Name");
  });

  // ── Section 3: Pagination ──────────────────────────────────────

  it("creates 2 more projects (total 3)", async () => {
    const res1 = await post(
      "/api/projects",
      { name: "Project B", slug: "project-b" },
      { cookie: cookies },
    );
    expect(res1.status).toBe(201);

    const res2 = await post(
      "/api/projects",
      { name: "Project C", slug: "project-c" },
      { cookie: cookies },
    );
    expect(res2.status).toBe(201);
  });

  it("lists with limit=2 - page 1", async () => {
    const response = await get("/api/projects?limit=2", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.page).toBe(1);
  });

  it("lists with limit=2&page=2 - page 2", async () => {
    const response = await get("/api/projects?limit=2&page=2", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(2);
  });

  // ── Section 3.5: FTS substring search and sort ─────────────────

  it("filters projects by FTS substring (3+ chars)", async () => {
    // FTS5 trigram tokenizer is case-insensitive and searches both name + slug,
    // so "Project" matches "Project B"/"Project C" by name and "New Name"
    // (slug "my-project") by slug.
    const response = await get("/api/projects?query=Project", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.items.map((p: { name: string }) => p.name).sort()).toEqual([
      "New Name",
      "Project B",
      "Project C",
    ]);
  });

  it("filters projects by name-only term", async () => {
    // "Project " (with trailing space) is unique to "Project B"/"Project C" names;
    // none of the slugs contain a space.
    const response = await get(`/api/projects?query=${encodeURIComponent("Project ")}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.items.map((p: { name: string }) => p.name).sort()).toEqual([
      "Project B",
      "Project C",
    ]);
  });

  it("falls back to LIKE for short query (<3 chars)", async () => {
    const response = await get("/api/projects?query=Ne", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe("New Name");
  });

  it("sorts by name ascending when sort=name", async () => {
    const response = await get("/api/projects?sort=name", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((p: { name: string }) => p.name)).toEqual([
      "New Name",
      "Project B",
      "Project C",
    ]);
  });

  it("rejects unknown sort value via schema", async () => {
    const response = await get("/api/projects?sort=invalid", { cookie: cookies });
    expect(response.status).toBe(400);
  });

  it("bumps lastActivityAt when a branch is created", async () => {
    const beforeRes = await get(`/api/projects/${projectId}`, { cookie: cookies });
    const before: string = (await beforeRes.json()).lastActivityAt;

    // Sleep to ensure a strictly newer ISO timestamp.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const branchRes = await post(
      "/api/branches",
      { projectId, name: "phase3-branch" },
      { cookie: cookies },
    );
    expect(branchRes.status).toBe(201);

    const afterRes = await get(`/api/projects/${projectId}`, { cookie: cookies });
    const after: string = (await afterRes.json()).lastActivityAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  // ── Section 4: Error cases ─────────────────────────────────────

  it("rejects renaming non-existent project (404)", async () => {
    const response = await patch(
      "/api/projects/00000000-0000-0000-0000-000000000000",
      { name: "Ghost" },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  // ── Section 5: Cross-org isolation ─────────────────────────────

  it("creates org B and switches to it", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "org-b-proj" },
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

  it("org B cannot rename org A project (404)", async () => {
    const response = await patch(
      `/api/projects/${projectId}`,
      { name: "Hijacked" },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  it("org B cannot delete org A project (404)", async () => {
    const response = await del(`/api/projects/${projectId}`, { cookie: cookies });
    expect(response.status).toBe(404);
  });

  // ── Section 6: Delete project ─────────────────────────────────

  it("switches back to original org", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    cookies = parseCookies(response) || cookies;
  });

  it("deletes the project", async () => {
    const response = await del(`/api/projects/${projectId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("deleted");
    expect(body.deleted).toBe(1);
  });

  it("confirms deleted project returns 404", async () => {
    const response = await get(`/api/projects/${projectId}`, { cookie: cookies });
    expect(response.status).toBe(404);
  });
});
