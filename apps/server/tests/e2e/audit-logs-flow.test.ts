import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-audit-logs");

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
      { name: "Audit Project", slug: "audit" },
      { cookie: cookies },
    );
    expect(projectResponse.status).toBe(201);
  });

  // ── Section 2: Audit log queries ──────────────────────────────

  it("lists audit logs with cursor-paginated shape", async () => {
    const response = await get("/api/audit-logs", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("nextCursor");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);

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
    expect(body.nextCursor).toBeNull();
  });

  it("paginates via cursor across multiple pages without overlap", async () => {
    // Generate enough rows to span 2 pages: create extra projects (each emits an audit log).
    for (let i = 0; i < 3; i++) {
      const created = await post(
        "/api/projects",
        { name: `Audit Extra ${i}`, slug: `audit-extra-${i}` },
        { cookie: cookies },
      );
      expect(created.status).toBe(201);
    }

    const firstResponse = await get("/api/audit-logs?limit=2", { cookie: cookies });
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondResponse = await get(
      `/api/audit-logs?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { cookie: cookies },
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.items.length).toBeGreaterThanOrEqual(1);

    // No id overlap between pages
    const firstIds = new Set(firstBody.items.map((i: { id: string }) => i.id));
    for (const item of secondBody.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }

    // Stable order: every second-page createdAt should be ≤ last item of first page
    const lastFirstAt = firstBody.items.at(-1).createdAt;
    for (const item of secondBody.items) {
      expect(item.createdAt <= lastFirstAt).toBe(true);
    }
  });

  it("ignores invalid cursor and returns first page", async () => {
    const response = await get("/api/audit-logs?cursor=garbage&limit=5", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
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
