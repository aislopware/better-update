import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-projects");

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

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

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

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "My Project", scopeKey: "@my/project" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("organizationId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("scopeKey");
    expect(body).toHaveProperty("createdAt");
    expect(body.name).toBe("My Project");
    expect(body.scopeKey).toBe("@my/project");
    projectId = body.id;
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
    expect(body.scopeKey).toBe("@my/project");
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
      { name: "Project B", scopeKey: "@my/project-b" },
      { cookie: cookies },
    );
    expect(res1.status).toBe(201);

    const res2 = await post(
      "/api/projects",
      { name: "Project C", scopeKey: "@my/project-c" },
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
});
