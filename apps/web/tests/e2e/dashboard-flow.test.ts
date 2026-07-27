import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, del, parseCookies } = setupE2EDashboard();

describe("dashboard full journey", () => {
  const state = { cookies: "", organizationId: "", projectId: "", robotAccountId: "" };

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
    state.projectId = body.id;
  });

  it("lists projects - project appears", async () => {
    const response = await get("/api/projects", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.some((proj: { name: string }) => proj.name === "Flow Project")).toBe(true);
  });

  // Machine credentials are project-scoped robot accounts (the better-auth
  // api-key plugin they replaced is gone). The age keypair is generated
  // client-side, so the fixture below only stands in for its public half —
  // nothing here decrypts a vault.
  it("creates a robot account", async () => {
    const response = await post(
      "/api/robot-accounts",
      {
        name: "flow-test-robot",
        projectId: state.projectId,
        role: "maintainer",
        publicKey: "age1e2efixtureflowtestrobot",
        fingerprint: "SHA256:e2e-fixture-flow-test-robot",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.bearerSecret).toMatch(/^bu_robot_/);
    expect(body.projectId).toBe(state.projectId);
    expect(body.role).toBe("maintainer");
    state.robotAccountId = body.id;
  });

  it("lists robot accounts - robot appears without its secret", async () => {
    const response = await get(`/api/robot-accounts?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const robot = body.items.find((item: { id: string }) => item.id === state.robotAccountId);
    expect(robot).toBeDefined();
    // Only the first few plaintext characters are exposed, so a masked CI
    // variable can be matched back to its robot — never the secret itself.
    expect(robot.bearerStart).toMatch(/^bu_/);
    expect(robot).not.toHaveProperty("bearerSecret");
  });

  it("revokes the robot account", async () => {
    const response = await del(`/api/robot-accounts/${state.robotAccountId}`, undefined, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
  });

  it("revoked robot no longer in list", async () => {
    const response = await get(`/api/robot-accounts?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.some((item: { id: string }) => item.id === state.robotAccountId)).toBe(false);
  });
});
