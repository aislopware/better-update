import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-audit-logs");

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

// ── Audit Logs API E2E ──────────────────────────────────────────

describe("Audit Logs API flow", () => {
  let cookies: string;
  let organizationId: string;

  // ── Section 1: Auth bootstrap + seed data ─────────────────────

  it("registers a user and creates a project", async () => {
    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "Audit E2E User",
      email: "audit-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    cookies = parseCookies(signUpResponse);

    const orgResponse = await post(
      "/api/auth/organization/create",
      { name: "Audit Org", slug: "audit-org" },
      { cookie: cookies },
    );
    expect(orgResponse.status).toBe(200);
    const org = await orgResponse.json();
    organizationId = org.id;
    cookies = parseCookies(orgResponse) || cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;

    // Create a project to generate a "project.create" audit log
    const projectResponse = await post(
      "/api/projects",
      { name: "Audit Project", scopeKey: "@test/audit" },
      { cookie: cookies },
    );
    expect(projectResponse.status).toBe(201);
  });

  // ── Section 2: Audit log queries ──────────────────────────────

  it("lists audit logs with valid shape", async () => {
    const response = await get("/api/audit-logs", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const item = body.items[0];
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("organizationId");
    expect(item).toHaveProperty("actorEmail");
    expect(item).toHaveProperty("action");
    expect(item).toHaveProperty("resourceType");
    expect(item).toHaveProperty("source");
    expect(item).toHaveProperty("createdAt");
  });

  it("filters by resourceType=project", async () => {
    const response = await get("/api/audit-logs?resourceType=project", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) {
      expect(item.resourceType).toBe("project");
    }
  });

  it("returns empty list for unused filter", async () => {
    const response = await get("/api/audit-logs?resourceType=credential", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("supports pagination", async () => {
    const response = await get("/api/audit-logs?limit=1&page=1", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(1);
  });

  // ── Section 3: Auth enforcement ───────────────────────────────

  it("rejects unauthenticated request (401)", async () => {
    const response = await get("/api/audit-logs");
    expect(response.status).toBe(401);
  });

  // ── Section 4: Cross-org isolation ────────────────────────────

  let attackerCookies: string;

  it("registers a second user in a different org", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Audit Attacker",
      email: "audit-attacker@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    attackerCookies = parseCookies(signUp);

    const orgResponse = await post(
      "/api/auth/organization/create",
      { name: "Attacker Audit Org", slug: "attacker-audit-org" },
      { cookie: attackerCookies },
    );
    expect(orgResponse.status).toBe(200);
    attackerCookies = parseCookies(orgResponse) || attackerCookies;

    const setActive = await post(
      "/api/auth/organization/set-active",
      { organizationId: (await orgResponse.json()).id },
      { cookie: attackerCookies },
    );
    expect(setActive.status).toBe(200);
    attackerCookies = parseCookies(setActive) || attackerCookies;
  });

  it("attacker cannot see original org audit logs", async () => {
    const response = await get("/api/audit-logs", {
      cookie: attackerCookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    for (const item of body.items) {
      expect(item.organizationId).not.toBe(organizationId);
    }
  });
});
