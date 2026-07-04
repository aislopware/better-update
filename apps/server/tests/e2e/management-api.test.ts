import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-mgmt");

// ── Management API happy path ─────────────────────────────────────

describe("Management API happy path", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let apiKeyValue: string;
  let apiKeyId: string;

  // ── Section 1: User + Organization Setup ────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "E2E User",
      email: "e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("e2e@example.com");
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Test Org", slug: "test-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.slug).toBe("test-org");
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

  it("lists organizations", async () => {
    const response = await get("/api/auth/organization/list", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const orgs = Array.isArray(body) ? body : (body.organizations ?? body);
    expect(orgs.some((o: { id: string }) => o.id === organizationId)).toBe(true);
  });

  // ── Section 2: Session-based Management API ─────────────────────

  it("GET /api/projects returns 200 with active org session", async () => {
    const response = await get("/api/projects", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
  });

  it("POST /api/projects returns 201 with active org session", async () => {
    const response = await post(
      "/api/projects",
      { name: "My Project", slug: "test-app" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("slug");
    projectId = body.id;
  });

  it("management API still rejects requests without auth", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });

  // ── Section 3: Robot bearer lifecycle ───────────────────────────

  it("creates a project robot account", async () => {
    const response = await post(
      "/api/robot-accounts",
      {
        name: "e2e-test-robot",
        projectId,
        role: "maintainer",
        publicKey: "age1e2efixturee2etestrobot",
        fingerprint: "SHA256:e2e-fixture-e2e-test-robot",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.bearerSecret).toMatch(/^bu_robot_/);
    apiKeyValue = body.bearerSecret;
    apiKeyId = body.id;
  });

  it("GET /api/projects with a robot bearer sees exactly the robot's project", async () => {
    const response = await get("/api/projects", {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(projectId);
  });

  it("POST /api/projects with a robot bearer is refused (project-scoped token)", async () => {
    const response = await post(
      "/api/projects",
      { name: "API Key Project", slug: "key-app" },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(403);
  });

  it("rejects requests with an invalid robot bearer", async () => {
    const response = await get("/api/projects", {
      authorization: "Bearer bu_robot_this_is_not_a_valid_secret",
    });
    expect(response.status).toBe(401);
  });

  it("rejects requests with a non-API-key bearer token", async () => {
    const response = await get("/api/projects", {
      authorization: "Bearer not-an-api-key-at-all",
    });
    expect(response.status).toBe(401);
  });

  // ── Section 4: Robot revocation ─────────────────────────────────

  it("revokes the robot account", async () => {
    const response = await del(`/api/robot-accounts/${apiKeyId}`, { cookie: cookies });
    expect(response.status).toBe(200);
  });

  it("rejects requests with a revoked robot bearer", async () => {
    const response = await get("/api/projects", {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(401);
  });
});
