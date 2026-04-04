import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-isolation");

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

// ── Cross-flow: auth → org ×2 → projects → API keys → isolation ─

describe("Multi-org data isolation", () => {
  let cookies: string;
  let orgAId: string;
  let orgBId: string;
  let apiKeyA: string;
  let apiKeyB: string;

  // ── Section 1: User signup + two orgs ──────────────────────────

  it("registers user and creates org A", async () => {
    const signupRes = await post("/api/auth/sign-up/email", {
      name: "Multi-Org User",
      email: "multi@example.com",
      password: "SecureP@ss123",
    });
    expect(signupRes.status).toBe(200);
    cookies = parseCookies(signupRes);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Alpha Org", slug: "alpha-org" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    orgAId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const setActiveRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgAId },
      { cookie: cookies },
    );
    expect(setActiveRes.status).toBe(200);
    cookies = parseCookies(setActiveRes) || cookies;
  });

  it("creates org B and re-activates org A", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Beta Org", slug: "beta-org" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    orgBId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    // org create auto-activates the new org — switch back to A
    const reactivateRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgAId },
      { cookie: cookies },
    );
    expect(reactivateRes.status).toBe(200);
    cookies = parseCookies(reactivateRes) || cookies;
  });

  // ── Section 2: Project in org A ────────────────────────────────

  it("creates a project in org A (session auth)", async () => {
    const res = await post(
      "/api/projects",
      { name: "Alpha Project", scopeKey: "@alpha/app" },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("Alpha Project");
  });

  it("org A has 1 project via session", async () => {
    const res = await get("/api/projects", { cookie: cookies });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Alpha Project");
  });

  // ── Section 3: Switch to org B — verify isolation ──────────────

  it("switches active org to B", async () => {
    const res = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    cookies = parseCookies(res) || cookies;
  });

  it("org B has 0 projects via session (data isolation)", async () => {
    const res = await get("/api/projects", { cookie: cookies });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(0);
  });

  it("creates a project in org B", async () => {
    const res = await post(
      "/api/projects",
      { name: "Beta Project", scopeKey: "@beta/app" },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("Beta Project");
  });

  // ── Section 4: API key scoping ─────────────────────────────────

  it("creates API key for org A", async () => {
    const res = await post(
      "/api/auth/api-key/create",
      { name: "key-alpha", organizationId: orgAId },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyA = body.key;
  });

  it("creates API key for org B", async () => {
    const res = await post(
      "/api/auth/api-key/create",
      { name: "key-beta", organizationId: orgBId },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyB = body.key;
  });

  it("org A key sees only Alpha Project", async () => {
    const res = await get("/api/projects", {
      authorization: `Bearer ${apiKeyA}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Alpha Project");
  });

  it("org B key sees only Beta Project", async () => {
    const res = await get("/api/projects", {
      authorization: `Bearer ${apiKeyB}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Beta Project");
  });

  // ── Section 5: Cross-org key cannot leak data ──────────────────

  it("project created via org A key stays in org A", async () => {
    const createRes = await post(
      "/api/projects",
      { name: "Extra Alpha", scopeKey: "@alpha/extra" },
      { authorization: `Bearer ${apiKeyA}` },
    );
    expect(createRes.status).toBe(201);

    // org A now has 2 projects
    const orgARes = await get("/api/projects", {
      authorization: `Bearer ${apiKeyA}`,
    });
    expect((await orgARes.json()).items).toHaveLength(2);

    // org B still has 1 project — no leakage
    const orgBRes = await get("/api/projects", {
      authorization: `Bearer ${apiKeyB}`,
    });
    const orgBBody = await orgBRes.json();
    expect(orgBBody.items).toHaveLength(1);
    expect(orgBBody.items[0].name).toBe("Beta Project");
  });
});
