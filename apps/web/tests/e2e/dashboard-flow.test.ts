import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, parseCookies } = setupE2EDashboard();

describe("dashboard full journey", () => {
  const state = { cookies: "", organizationId: "", apiKeyId: "" };

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Dashboard User",
      email: "dashboard@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("dashboard@example.com");
    state.cookies = parseCookies(response);
    expect(state.cookies.length).toBeGreaterThan(0);
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Dashboard Org", slug: "dashboard-org" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.slug).toBe("dashboard-org");
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

  it("lists organizations - new org appears", async () => {
    const response = await get("/api/auth/organization/list", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    const orgs = Array.isArray(body) ? body : (body.organizations ?? body);
    expect(orgs.some((org: { id: string }) => org.id === state.organizationId)).toBe(true);
  });

  it("creates a project - returns 201", async () => {
    const response = await post(
      "/api/projects",
      { name: "Flow Project", slug: "flow" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("Flow Project");
    expect(body.slug).toBe("flow");
  });

  it("lists projects - project appears", async () => {
    const response = await get("/api/projects", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.some((proj: { name: string }) => proj.name === "Flow Project")).toBe(true);
  });

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "flow-test-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toBeDefined();
    expect(body.key).toMatch(/^bu_/);
    state.apiKeyId = body.id;
  });

  it("lists API keys - key appears", async () => {
    const response = await get(`/api/auth/api-key/list?organizationId=${state.organizationId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.apiKeys ?? body;
    expect(keys.some((key: { id: string }) => key.id === state.apiKeyId)).toBe(true);
  });

  it("deletes the API key", async () => {
    const response = await post(
      "/api/auth/api-key/delete",
      { keyId: state.apiKeyId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
  });

  it("deleted key no longer in list", async () => {
    const response = await get(`/api/auth/api-key/list?organizationId=${state.organizationId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.apiKeys ?? body;
    expect(keys.some((key: { id: string }) => key.id === state.apiKeyId)).toBe(false);
  });
});
