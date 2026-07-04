import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-isolation");

// ── Cross-flow: auth → org ×2 → projects → API keys → isolation ─

describe("Multi-org data isolation", () => {
  let cookies: string;
  let orgAId: string;
  let orgBId: string;
  let projectAId: string;
  let projectBId: string;
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
      { name: "Alpha Project", slug: "alpha-app" },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Alpha Project");
    projectAId = created.id;
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
      { name: "Beta Project", slug: "beta-app" },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Beta Project");
    projectBId = created.id;
  });

  // ── Section 4: Robot bearer scoping ────────────────────────────

  it("creates a project robot for org A", async () => {
    // Robot creation is scoped to the ACTIVE org — activate org A first.
    const activateA = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgAId },
      { cookie: cookies },
    );
    expect(activateA.status).toBe(200);
    cookies = parseCookies(activateA) || cookies;

    const res = await post(
      "/api/robot-accounts",
      {
        name: "robot-alpha",
        projectId: projectAId,
        role: "maintainer",
        publicKey: "age1e2efixturealpha",
        fingerprint: "SHA256:e2e-fixture-alpha",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bearerSecret).toMatch(/^bu_robot_/);
    apiKeyA = body.bearerSecret;
  });

  it("creates a project robot for org B", async () => {
    const activateB = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(activateB.status).toBe(200);
    cookies = parseCookies(activateB) || cookies;

    const res = await post(
      "/api/robot-accounts",
      {
        name: "robot-beta",
        projectId: projectBId,
        role: "maintainer",
        publicKey: "age1e2efixturebeta",
        fingerprint: "SHA256:e2e-fixture-beta",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bearerSecret).toMatch(/^bu_robot_/);
    apiKeyB = body.bearerSecret;
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

  // ── Section 5: Robots are project-scoped tokens ─────────────────

  it("a robot cannot create projects, and org B stays isolated", async () => {
    // Robots are project-scoped (GITLAB-RBAC-SPEC §1b, v2): a per-project CI
    // credential must not widen its own footprint.
    const createRes = await post(
      "/api/projects",
      { name: "Extra Alpha", slug: "alpha-extra" },
      { authorization: `Bearer ${apiKeyA}` },
    );
    expect(createRes.status).toBe(403);

    // org A robot still sees exactly its project
    const orgARes = await get("/api/projects", {
      authorization: `Bearer ${apiKeyA}`,
    });
    expect((await orgARes.json()).items).toHaveLength(1);

    // org B robot untouched — no leakage
    const orgBRes = await get("/api/projects", {
      authorization: `Bearer ${apiKeyB}`,
    });
    const orgBBody = await orgBRes.json();
    expect(orgBBody.items).toHaveLength(1);
    expect(orgBBody.items[0].name).toBe("Beta Project");
  });
});
