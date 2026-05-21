import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-analytics");

// ── Analytics endpoints ──────────────────────────────────────────

describe("Analytics endpoints", () => {
  let cookies: string;
  let projectId: string;

  // ── Auth + project setup ──────────────────────────────────────

  it("registers a user and creates a project", async () => {
    // Sign up
    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "Analytics E2E User",
      email: "analytics-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    cookies = parseCookies(signUpResponse);

    // Create org
    const orgResponse = await post(
      "/api/auth/organization/create",
      { name: "Analytics Org", slug: "analytics-org" },
      { cookie: cookies },
    );
    expect(orgResponse.status).toBe(200);
    const org = await orgResponse.json();
    cookies = parseCookies(orgResponse) || cookies;

    // Set active org
    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: org.id },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;

    // Create project
    const projectResponse = await post(
      "/api/projects",
      { name: "Analytics Project", slug: "analytics" },
      { cookie: cookies },
    );
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json();
    projectId = project.id;
  });

  // ── Auth enforcement ──────────────────────────────────────────

  it("GET /api/analytics/adoption rejects unauthenticated requests", async () => {
    const response = await get(`/api/analytics/adoption?projectId=${projectId}`);
    expect(response.status).toBe(401);
  });

  it("GET /api/analytics/updates rejects unauthenticated requests", async () => {
    const response = await get(
      `/api/analytics/updates?projectId=${projectId}&updateId=test-update`,
    );
    expect(response.status).toBe(401);
  });

  it("GET /api/analytics/channels rejects unauthenticated requests", async () => {
    const response = await get(`/api/analytics/channels?projectId=${projectId}&channel=production`);
    expect(response.status).toBe(401);
  });

  it("GET /api/analytics/platforms rejects unauthenticated requests", async () => {
    const response = await get(`/api/analytics/platforms?projectId=${projectId}`);
    expect(response.status).toBe(401);
  });

  // ── Authenticated responses (WAE unavailable -> empty results) ─

  it("GET /api/analytics/adoption returns valid shape", async () => {
    const response = await get(`/api/analytics/adoption?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("updates");
    expect(Array.isArray(body.updates)).toBe(true);
  });

  it("GET /api/analytics/updates returns valid shape", async () => {
    const response = await get(
      `/api/analytics/updates?projectId=${projectId}&updateId=test-update`,
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("updateId");
    expect(body).toHaveProperty("totalRequests");
    expect(body).toHaveProperty("byResponseType");
    expect(body).toHaveProperty("timeSeries");
  });

  it("GET /api/analytics/channels returns valid shape", async () => {
    const response = await get(
      `/api/analytics/channels?projectId=${projectId}&channel=production`,
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("channel");
    expect(body).toHaveProperty("totalRequests");
    expect(body).toHaveProperty("responseTypeDistribution");
  });

  it("GET /api/analytics/platforms returns valid shape", async () => {
    const response = await get(`/api/analytics/platforms?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("platforms");
    expect(Array.isArray(body.platforms)).toBe(true);
  });

  // ── Cross-org authorization ─────────────────────────────────

  let attackerCookies: string;

  it("registers a second user in a different org", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Attacker User",
      email: "attacker@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    attackerCookies = parseCookies(signUp);

    const orgResponse = await post(
      "/api/auth/organization/create",
      { name: "Attacker Org", slug: "attacker-org" },
      { cookie: attackerCookies },
    );
    expect(orgResponse.status).toBe(200);
    const org = await orgResponse.json();
    attackerCookies = parseCookies(orgResponse) || attackerCookies;

    const setActive = await post(
      "/api/auth/organization/set-active",
      { organizationId: org.id },
      { cookie: attackerCookies },
    );
    expect(setActive.status).toBe(200);
    attackerCookies = parseCookies(setActive) || attackerCookies;
  });

  it("rejects cross-org analytics access on adoption endpoint", async () => {
    const response = await get(`/api/analytics/adoption?projectId=${projectId}`, {
      cookie: attackerCookies,
    });
    expect([403, 404]).toContain(response.status);
  });

  it("rejects cross-org analytics access on platforms endpoint", async () => {
    const response = await get(`/api/analytics/platforms?projectId=${projectId}`, {
      cookie: attackerCookies,
    });
    expect([403, 404]).toContain(response.status);
  });
});
