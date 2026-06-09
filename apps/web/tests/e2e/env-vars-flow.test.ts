import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, seedSql, parseCookies } = setupE2EDashboard();

// Single-quote a value for inline SQL. Our fixtures are UUIDs + ASCII literals
// (no apostrophes), but escape defensively all the same.
const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Env var values are end-to-end encrypted: the CLI seals each value client-side
// under the org vault and the server stores only ciphertext, so every mutation
// goes through the CLI (which holds the vault key). The dashboard is READ-ONLY
// for env vars — see `-env-var-row.tsx` ("Read-only … only readable via the
// CLI"). This flow therefore seeds encrypted env-var rows directly (opaque
// ciphertext the dashboard never decrypts) and asserts the dashboard API lists
// the METADATA read-only — merging scopes, surfacing the project-over-global
// override, never exposing a plaintext value — and rejects the legacy
// plaintext-create shape. The encrypted mutation lifecycle (set / pull / revise)
// is covered end-to-end by the CLI e2e (apps/cli/tests/e2e/env-commands.test.ts).
describe("dashboard environment variables flow (read-only)", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
  };

  it("registers a user and activates an organization", async () => {
    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "Dashboard Env User",
      email: "dashboard-env@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    state.cookies = parseCookies(signUpResponse);

    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Dashboard Env Org", slug: "dashboard-env-org" },
      { cookie: state.cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    const createOrgBody = await createOrgResponse.json();
    state.organizationId = createOrgBody.id;
    state.cookies = parseCookies(createOrgResponse) || state.cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    state.cookies = parseCookies(setActiveResponse) || state.cookies;
  });

  it("creates a project and seeds encrypted env vars", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Dashboard Env Project", slug: "dashboard-env" },
      { cookie: state.cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    const createProjectBody = await createProjectResponse.json();
    state.projectId = createProjectBody.id;

    // Four encrypted env vars (all `production`): two globals, one project var
    // that shadows a global of the same key (the override case), and one
    // project-only sensitive var. Each row points at a single revision whose
    // ciphertext/DEK are opaque placeholders — the dashboard reads only metadata
    // and never decrypts, so real sealing is unnecessary here.
    const orgId = sql(state.organizationId);
    const projectId = sql(state.projectId);
    seedSql(`
INSERT INTO "env_vars"
  ("id","organization_id","project_id","scope","environment","key","visibility","current_revision_id","created_at","updated_at")
VALUES
  ('ev-global-api',${orgId},NULL,'global','production','EXPO_PUBLIC_API_URL','plaintext','rev-global-api','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z'),
  ('ev-global-flag',${orgId},NULL,'global','production','FEATURE_FLAG','plaintext','rev-global-flag','2024-02-02T00:00:00Z','2024-02-02T00:00:00Z'),
  ('ev-proj-api',${orgId},${projectId},'project','production','EXPO_PUBLIC_API_URL','plaintext','rev-proj-api','2024-02-03T00:00:00Z','2024-02-03T00:00:00Z'),
  ('ev-proj-sentry',${orgId},${projectId},'project','production','SENTRY_AUTH_TOKEN','sensitive','rev-proj-sentry','2024-02-04T00:00:00Z','2024-02-04T00:00:00Z');

INSERT INTO "env_var_revisions"
  ("id","env_var_id","organization_id","revision_number","value_ciphertext","wrapped_dek","vault_version","created_by_user_id","created_at","updated_at")
VALUES
  ('rev-global-api','ev-global-api',${orgId},1,'ciphertext-global-api','wrapped-dek-global-api',1,NULL,'2024-02-01T00:00:00Z','2024-02-01T00:00:00Z'),
  ('rev-global-flag','ev-global-flag',${orgId},1,'ciphertext-global-flag','wrapped-dek-global-flag',1,NULL,'2024-02-02T00:00:00Z','2024-02-02T00:00:00Z'),
  ('rev-proj-api','ev-proj-api',${orgId},1,'ciphertext-proj-api','wrapped-dek-proj-api',1,NULL,'2024-02-03T00:00:00Z','2024-02-03T00:00:00Z'),
  ('rev-proj-sentry','ev-proj-sentry',${orgId},1,'ciphertext-proj-sentry','wrapped-dek-proj-sentry',1,NULL,'2024-02-04T00:00:00Z','2024-02-04T00:00:00Z');
`);
  });

  it("lists global env-var metadata without exposing values", async () => {
    const response = await get("/api/env-vars?scope=global", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    const byKey = new Map(body.items.map((item: { key: string }) => [item.key, item]));
    expect(byKey.get("EXPO_PUBLIC_API_URL")).toStrictEqual(
      expect.objectContaining({
        scope: "global",
        environment: "production",
        key: "EXPO_PUBLIC_API_URL",
        visibility: "plaintext",
      }),
    );
    expect(byKey.get("FEATURE_FLAG")).toStrictEqual(
      expect.objectContaining({ scope: "global", key: "FEATURE_FLAG" }),
    );
    // Metadata only — the encrypted value never crosses the wire.
    for (const item of body.items as { value?: unknown }[]) {
      expect(item.value).toBeUndefined();
    }
    expect(JSON.stringify(body)).not.toContain("ciphertext-");
  });

  it("merges scope=all with the project-over-global override", async () => {
    const response = await get(`/api/env-vars?projectId=${state.projectId}&scope=all`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const byKey = new Map(body.items.map((item: { key: string }) => [item.key, item]));
    // EXPO (project shadows global) + FEATURE_FLAG (global, unshadowed) + SENTRY (project).
    expect(byKey.size).toBe(3);
    expect(byKey.get("EXPO_PUBLIC_API_URL")).toStrictEqual(
      expect.objectContaining({ scope: "project", overridesGlobal: true }),
    );
    expect(byKey.get("FEATURE_FLAG")).toStrictEqual(expect.objectContaining({ scope: "global" }));
    expect(byKey.get("SENTRY_AUTH_TOKEN")).toStrictEqual(
      expect.objectContaining({ scope: "project", visibility: "sensitive" }),
    );
    for (const item of body.items as { value?: unknown }[]) {
      expect(item.value).toBeUndefined();
    }
  });

  it("gets a single env var's metadata", async () => {
    const response = await get("/api/env-vars/ev-proj-sentry", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toStrictEqual(
      expect.objectContaining({
        id: "ev-proj-sentry",
        scope: "project",
        environment: "production",
        key: "SENTRY_AUTH_TOKEN",
        visibility: "sensitive",
      }),
    );
    expect(body.value).toBeUndefined();
  });

  it("rejects the legacy plaintext-create shape (values are sealed client-side)", async () => {
    // The create endpoint requires a client-sealed value envelope; the pre-E2E
    // dashboard shape (a bare plaintext `value` + plural `environments` array) no
    // longer satisfies the contract and is rejected before any write.
    const response = await post(
      "/api/env-vars",
      {
        scope: "global",
        environments: ["production"],
        key: "EXPO_PUBLIC_LEGACY",
        value: "https://legacy.example.com",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(400);
  });
});
