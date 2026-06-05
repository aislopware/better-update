import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-environments");

// ── Environments API E2E ─────────────────────────────────────────
// Environments are org-scoped: three virtual built-ins (development/preview/
// production) plus user-defined rows. Built-ins cannot be renamed or deleted.

describe("Environments API flow", () => {
  let cookies: string;
  let organizationId: string;

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Env E2E User",
      email: "environments-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Env Org", slug: "env-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    organizationId = (await response.json()).id;
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

  // ── Built-ins ───────────────────────────────────────────────────

  it("lists the three built-in environments", async () => {
    const response = await get("/api/environments", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((e: { name: string }) => e.name)).toEqual([
      "development",
      "preview",
      "production",
    ]);
    expect(body.items.every((e: { isBuiltin: boolean }) => e.isBuiltin)).toBe(true);
  });

  // ── Create ──────────────────────────────────────────────────────

  it("creates a user-defined environment", async () => {
    const response = await post("/api/environments", { name: "staging" }, { cookie: cookies });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("staging");
    expect(body.isBuiltin).toBe(false);
  });

  it("lists built-ins plus the new environment", async () => {
    const response = await get("/api/environments", { cookie: cookies });
    const body = await response.json();
    expect(body.items.map((e: { name: string }) => e.name)).toEqual([
      "development",
      "preview",
      "production",
      "staging",
    ]);
  });

  it("rejects creating an environment with a built-in name (409)", async () => {
    const response = await post("/api/environments", { name: "production" }, { cookie: cookies });
    expect(response.status).toBe(409);
  });

  it("rejects creating a duplicate environment (409)", async () => {
    const response = await post("/api/environments", { name: "staging" }, { cookie: cookies });
    expect(response.status).toBe(409);
  });

  it("rejects an invalid environment name (4xx)", async () => {
    const response = await post("/api/environments", { name: "Staging!" }, { cookie: cookies });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  // ── Rename ──────────────────────────────────────────────────────

  it("renames a user-defined environment", async () => {
    const response = await patch("/api/environments/staging", { name: "qa" }, { cookie: cookies });
    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("qa");
  });

  it("rejects renaming a built-in environment (409)", async () => {
    const response = await patch(
      "/api/environments/production",
      { name: "prod" },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  // ── Delete ──────────────────────────────────────────────────────

  it("rejects deleting a built-in environment (409)", async () => {
    const response = await del("/api/environments/production", { cookie: cookies });
    expect(response.status).toBe(409);
  });

  it("deletes a user-defined environment with no bound variables", async () => {
    const response = await del("/api/environments/qa", { cookie: cookies });
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(1);
  });

  it("rejects deleting a non-existent environment (404)", async () => {
    const response = await del("/api/environments/qa", { cookie: cookies });
    expect(response.status).toBe(404);
  });
});
