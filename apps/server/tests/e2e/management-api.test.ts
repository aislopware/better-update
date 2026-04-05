import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-mgmt");

// ── Helpers ───────────────────────────────────────────────────────

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, headers ? { headers } : {});

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

// ── Management API happy path ─────────────────────────────────────

describe("Management API happy path", () => {
  let cookies: string;
  let organizationId: string;
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
      { name: "My Project", scopeKey: "@test/app" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("scopeKey");
  });

  it("management API still rejects requests without auth", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });

  // ── Section 3: API Key Lifecycle ────────────────────────────────

  it("creates an API key for the organization", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "e2e-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toBeDefined();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
    apiKeyId = body.id;
  });

  it("GET /api/projects works with API key (bearer auth)", async () => {
    const response = await get("/api/projects", {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
  });

  it("POST /api/projects works with API key", async () => {
    const response = await post(
      "/api/projects",
      { name: "API Key Project", scopeKey: "@key/app" },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
  });

  it("rejects requests with an invalid API key", async () => {
    const response = await get("/api/projects", {
      authorization: "Bearer bu_this_is_not_a_valid_key",
    });
    expect(response.status).toBe(401);
  });

  it("rejects requests with a non-API-key bearer token", async () => {
    const response = await get("/api/projects", {
      authorization: "Bearer not-an-api-key-at-all",
    });
    expect(response.status).toBe(401);
  });

  // ── Section 4: API Key Deletion ─────────────────────────────────

  it("deletes the API key", async () => {
    const response = await post(
      "/api/auth/api-key/delete",
      { keyId: apiKeyId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
  });

  it("rejects requests with a deleted API key", async () => {
    const response = await get("/api/projects", {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(401);
  });
});
