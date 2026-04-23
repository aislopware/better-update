import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, patch, parseCookies } = setupE2EDashboard();

describe("dashboard branches journey", () => {
  const state = { cookies: "", organizationId: "", projectId: "", branchId: "" };

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Branch Dashboard User",
      email: "branch-dash@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("branch-dash@example.com");
    state.cookies = parseCookies(response);
    expect(state.cookies.length).toBeGreaterThan(0);
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Branch Dash Org", slug: "branch-dash-org" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
    state.organizationId = body.id;
    state.cookies = parseCookies(response) || state.cookies;
  });

  it("sets the organization as active", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response) || state.cookies;
  });

  // ── Section 2: Project prerequisite ────────────────────────────

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Branch Dashboard Project", slug: "branch-dash" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    state.projectId = body.id;
  });

  // ── Section 3: Branch CRUD + errors ────────────────────────────

  it("creates a branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId: state.projectId, name: "main" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("createdAt");
    expect(body.name).toBe("main");
    state.branchId = body.id;
  });

  it("lists branches - branch appears", async () => {
    const response = await get(`/api/branches?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("main");
  });

  it("renames the branch", async () => {
    const response = await patch(
      `/api/branches/${state.branchId}`,
      { name: "production" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("production");
  });

  it("lists branches - rename persisted", async () => {
    const response = await get(`/api/branches?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("production");
  });

  it("creates a second branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId: state.projectId, name: "staging" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("staging");
  });

  it("rejects duplicate branch name (409)", async () => {
    const response = await post(
      "/api/branches",
      { projectId: state.projectId, name: "staging" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(409);
  });
});
