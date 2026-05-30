import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-webhooks");

// ── Webhooks API E2E ─────────────────────────────────────────────

describe("Webhooks API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let webhookId: string;
  let projectScopedId: string;
  let keyHookId: string;
  let apiKeyValue: string;

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Webhook E2E User",
      email: "webhook-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Webhook Org", slug: "webhook-org" },
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

  // ── Section 2: Prerequisites ───────────────────────────────────

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Webhook Test Project", slug: "webhook-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    projectId = body.id;
  });

  // ── Section 3: Webhook CRUD (session auth) ─────────────────────

  it("creates a webhook (org-scoped, no projectId) - 201 + secret returned once", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "Deploy notifier", url: "https://example.com/hook", events: ["update.published"] },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("organizationId");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("url");
    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("createdAt");
    expect(body).toHaveProperty("updatedAt");
    expect(body).toHaveProperty("secret");
    expect(body.organizationId).toBe(organizationId);
    expect(body.projectId).toBeNull();
    expect(body.name).toBe("Deploy notifier");
    expect(body.url).toBe("https://example.com/hook");
    expect(body.events).toEqual(["update.published"]);
    expect(body.enabled).toBe(true);
    expect(body.secret).toEqual(expect.any(String));
    expect(body.secret).toHaveLength(64);
    webhookId = body.id;
  });

  it("creates a project-scoped webhook with two events - 201", async () => {
    const response = await post(
      "/api/webhooks",
      {
        name: "Build hook",
        url: "http://localhost:9000/cb",
        events: ["update.published", "build.completed"],
        projectId,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.projectId).toBe(projectId);
    expect(body.events).toEqual(["update.published", "build.completed"]);
    projectScopedId = body.id;
  });

  it("lists webhooks - both appear, ordered created_at DESC", async () => {
    const response = await get("/api/webhooks", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("page");
    expect(body).not.toHaveProperty("limit");
    expect(body.items).toHaveLength(2);
    expect(body.items.map((w: { name: string }) => w.name)).toContain("Deploy notifier");
    // plain Webhook (not WebhookWithSecret) - no secret on list
    expect(body.items[0].secret).toBeUndefined();
    // repo orders by created_at DESC - the project-scoped (created later) is items[0]
    expect(body.items[0].id).toBe(projectScopedId);
  });

  it("gets a single webhook by id - 200, no secret", async () => {
    const response = await get(`/api/webhooks/${webhookId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(webhookId);
    expect(body.name).toBe("Deploy notifier");
    expect(body.secret).toBeUndefined();
  });

  it("updates webhook (name + enabled false + events) - 200", async () => {
    const response = await patch(
      `/api/webhooks/${webhookId}`,
      { name: "Renamed hook", enabled: false, events: ["build.completed"] },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(webhookId);
    expect(body.name).toBe("Renamed hook");
    expect(body.enabled).toBe(false);
    expect(body.events).toEqual(["build.completed"]);
    // url unchanged - compact() drops undefined keys so only provided fields update
    expect(body.url).toBe("https://example.com/hook");
  });

  it("partial update (url only) leaves other fields intact - 200", async () => {
    const response = await patch(
      `/api/webhooks/${webhookId}`,
      { url: "https://example.com/hook-v2" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://example.com/hook-v2");
    expect(body.name).toBe("Renamed hook");
    expect(body.enabled).toBe(false);
  });

  // ── Section 4: Validation error cases ──────────────────────────

  it("rejects create with invalid (non-http) url - 400", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "Bad url", url: "ftp://example.com", events: ["update.published"] },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("rejects create with empty events array - 400", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "No events", url: "https://example.com/x", events: [] },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("rejects create with unknown event name - 400", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "Bad event", url: "https://example.com/x", events: ["deploy.failed"] },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("rejects create with empty name - 400", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "", url: "https://example.com/x", events: ["update.published"] },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("get non-existent webhook - 404", async () => {
    const response = await get("/api/webhooks/00000000-0000-0000-0000-000000000000", {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("update non-existent webhook - 404", async () => {
    const response = await patch(
      "/api/webhooks/00000000-0000-0000-0000-000000000000",
      { enabled: true },
      { cookie: cookies },
    );
    expect(response.status).toBe(404);
  });

  // ── Section 5: API key auth ────────────────────────────────────

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "webhook-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("webhook created via API key (Bearer) - 201", async () => {
    const response = await post(
      "/api/webhooks",
      { name: "Key hook", url: "https://example.com/key", events: ["update.published"] },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.organizationId).toBe(organizationId);
    expect(body.secret).toEqual(expect.any(String));
    keyHookId = body.id;
  });

  it("lists webhooks via API key - 200", async () => {
    const response = await get("/api/webhooks", { authorization: `Bearer ${apiKeyValue}` });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((w: { name: string }) => w.name === "Key hook")).toBe(true);
  });

  it("deletes a webhook via API key - 200 { deleted: 1 }", async () => {
    const response = await del(`/api/webhooks/${keyHookId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);
  });

  // ── Section 6: Deletion behavior ───────────────────────────────

  it("deletes the primary webhook (session) - 200 { deleted: 1 }", async () => {
    const response = await del(`/api/webhooks/${webhookId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);
  });

  it("delete non-existent webhook - 200 { deleted: 0 } (NOT 404)", async () => {
    const response = await del("/api/webhooks/00000000-0000-0000-0000-000000000000", {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(0);
  });

  it("list reflects deletions - gone", async () => {
    const response = await get("/api/webhooks", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.some((w: { id: string }) => w.id === webhookId)).toBe(false);
    // remaining = the project-scoped "Build hook" only (Key hook deleted via API key)
    expect(body.items).toHaveLength(1);
  });

  // ── Section 7: Cross-org isolation (list) ──────────────────────

  it("cross-org: list is org-scoped - org B sees none of org A's webhooks", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Webhook Org B", slug: "webhook-org-b" },
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

    const response = await get("/api/webhooks", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(0);

    // switch back to org A
    const backRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(backRes.status).toBe(200);
    cookies = parseCookies(backRes) || cookies;
  });
});
