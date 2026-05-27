import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-env-vars");

// Values are end-to-end encrypted: the server stores opaque sealed envelopes and
// never sees plaintext. These e2e tests use placeholder envelopes (random base64)
// and assert on the public metadata the server echoes back — the real
// seal/decrypt round-trip is covered by the CLI unit tests against
// `@better-update/credentials-crypto`. No vault is bootstrapped, so
// `assertVaultVersionCurrent` is a no-op and any vaultVersion is accepted.
describe("Environment variables API flow (E2E encrypted)", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    globalVarId: "",
    sensitiveVarId: "",
    overrideVarId: "",
  };

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Env Var User",
      email: "env-vars-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response);
    expect(state.cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Env Var Org", slug: "env-var-org" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    state.organizationId = body.id;
    state.cookies = parseCookies(response) || state.cookies;
  });

  it("sets the organization as active", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response) || state.cookies;
  });

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Env Project", slug: "env-app" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.projectId = body.id;
  });

  it("creates an API key for export auth", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "env-export-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    state.apiKey = body.key;
  });

  it("creates a global env var (no plaintext value in the response)", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "global",
        environment: "production",
        key: "EXPO_PUBLIC_API_URL",
        visibility: "plaintext",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.globalVarId = body.id;
    expect(body.scope).toBe("global");
    expect(body.projectId).toBeNull();
    expect(body.environment).toBe("production");
    expect(body.value).toBeUndefined();
    expect(body.currentRevisionId).toBeTruthy();
    expect(body.revisionNumber).toBe(1);
    expect(body.revisionCount).toBe(1);
  });

  it("rejects a global env var with a projectId", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "global",
        projectId: state.projectId,
        environment: "production",
        key: "BAD_GLOBAL",
        visibility: "plaintext",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(400);
  });

  it("creates a project sensitive env var", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environment: "production",
        key: "SENTRY_AUTH_TOKEN",
        visibility: "sensitive",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.sensitiveVarId = body.id;
    expect(body.visibility).toBe("sensitive");
    expect(body.environment).toBe("production");
    expect(body.value).toBeUndefined();
  });

  it("creates a project env var that overrides a global one", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environment: "production",
        key: "EXPO_PUBLIC_API_URL",
        visibility: "plaintext",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.overrideVarId = body.id;
    expect(body.scope).toBe("project");
  });

  it("rejects a duplicate project key in the same environment", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environment: "production",
        key: "EXPO_PUBLIC_API_URL",
        visibility: "plaintext",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects an unknown visibility tier", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environment: "production",
        key: "OLD_SECRET",
        visibility: "secret",
        value: credentialEnvelope(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(400);
  });

  it("lists project env vars merged with global override resolution", async () => {
    const response = await get(`/api/env-vars?projectId=${state.projectId}&scope=all`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const byKey = new Map(body.items.map((item: { key: string }) => [item.key, item]));
    expect(byKey.size).toBe(2);

    const apiUrl = byKey.get("EXPO_PUBLIC_API_URL") as {
      scope: string;
      overridesGlobal?: boolean;
      value?: unknown;
    };
    expect(apiUrl.scope).toBe("project");
    expect(apiUrl.overridesGlobal).toBe(true);
    expect(apiUrl.value).toBeUndefined();

    const sentry = byKey.get("SENTRY_AUTH_TOKEN") as { scope: string };
    expect(sentry.scope).toBe("project");
  });

  it("filters by environment", async () => {
    const response = await get(
      `/api/env-vars?projectId=${state.projectId}&scope=project&environments=production`,
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = [...new Set(body.items.map((item: { key: string }) => item.key))].toSorted();
    expect(keys).toEqual(["EXPO_PUBLIC_API_URL", "SENTRY_AUTH_TOKEN"]);
  });

  it("filters by search", async () => {
    const response = await get(
      `/api/env-vars?projectId=${state.projectId}&scope=project&search=sentry`,
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { key: string }) => item.key)).toEqual(["SENTRY_AUTH_TOKEN"]);
  });

  it("lists global env vars from org scope", async () => {
    const response = await get(`/api/env-vars?scope=global`, { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].key).toBe("EXPO_PUBLIC_API_URL");
    expect(body.items[0].scope).toBe("global");
  });

  it("updating the value appends a revision", async () => {
    const response = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { value: credentialEnvelope() },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revisionNumber).toBe(2);
    expect(body.revisionCount).toBe(2);
    expect(body.value).toBeUndefined();
  });

  it("lists the value history newest-first", async () => {
    const response = await get(`/api/env-vars/${state.sensitiveVarId}/revisions`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item: { revisionNumber: number }) => item.revisionNumber)).toEqual([
      2, 1,
    ]);
    expect(body.items[0].isCurrent).toBe(true);
    expect(body.items[1].isCurrent).toBe(false);
    // Metadata only — never the ciphertext.
    expect(body.items[0].ciphertext).toBeUndefined();
  });

  it("rolls back to an earlier revision", async () => {
    const history = await get(`/api/env-vars/${state.sensitiveVarId}/revisions`, {
      cookie: state.cookies,
    });
    const items = (await history.json()).items as { id: string; revisionNumber: number }[];
    const first = items.find((item) => item.revisionNumber === 1);
    expect(first).toBeDefined();

    const response = await post(
      `/api/env-vars/${state.sensitiveVarId}/rollback`,
      { toRevisionId: first?.id },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentRevisionId).toBe(first?.id);
  });

  it("updates visibility without adding a revision", async () => {
    const response = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { visibility: "plaintext" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.visibility).toBe("plaintext");
    expect(body.revisionCount).toBe(2);
  });

  it("bulk imports pre-sealed entries with per-environment fan-out", async () => {
    const response = await post(
      "/api/env-vars/bulk-import",
      {
        scope: "project",
        projectId: state.projectId,
        entries: [
          {
            key: "APP_TOKEN",
            environment: "development",
            visibility: "sensitive",
            value: credentialEnvelope(),
          },
          // duplicate (key, environment) — last wins, counts as skipped
          {
            key: "APP_TOKEN",
            environment: "development",
            visibility: "sensitive",
            value: credentialEnvelope(),
          },
          {
            key: "APP_TOKEN",
            environment: "production",
            visibility: "sensitive",
            value: credentialEnvelope(),
          },
          {
            key: "EXPO_PUBLIC_WEB_URL",
            environment: "development",
            visibility: "plaintext",
            value: credentialEnvelope(),
          },
          {
            key: "EXPO_PUBLIC_WEB_URL",
            environment: "production",
            visibility: "plaintext",
            value: credentialEnvelope(),
          },
        ],
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: 4, updated: 0, skipped: 1 });
  });

  it("rejects export from a browser cookie session", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { cookie: state.cookies },
    );
    expect(response.status).toBe(403);
  });

  it("exports sealed envelopes (project overrides global) with API key auth", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { authorization: `Bearer ${state.apiKey}` },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environment).toBe("production");
    const byKey = new Map(body.items.map((item: { key: string }) => [item.key, item] as const));

    const apiUrl = byKey.get("EXPO_PUBLIC_API_URL") as
      | {
          id: string;
          ciphertext: string;
          wrappedDek: string;
          vaultVersion: number;
          value?: unknown;
        }
      | undefined;
    expect(apiUrl).toBeDefined();
    expect(apiUrl?.ciphertext).toBeTruthy();
    expect(apiUrl?.wrappedDek).toBeTruthy();
    expect(apiUrl?.vaultVersion).toBe(1);
    // No plaintext value — the CLI decrypts the envelope locally.
    expect(apiUrl?.value).toBeUndefined();

    // APP_TOKEN (production) + EXPO_PUBLIC_WEB_URL (production) from the import.
    expect(byKey.has("APP_TOKEN")).toBe(true);
    expect(byKey.has("EXPO_PUBLIC_WEB_URL")).toBe(true);
  });

  it("exports with a CLI session token (bearer transport)", async () => {
    const generated = await get("/api/auth/one-time-token/generate", { cookie: state.cookies });
    expect(generated.status).toBe(200);
    const { token } = await generated.json();

    const verified = await post("/api/auth/one-time-token/verify", { token });
    expect(verified.status).toBe(200);
    const sessionToken = verified.headers.get("set-auth-token");
    expect(sessionToken).toBeTruthy();

    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { authorization: `Bearer ${sessionToken}` },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environment).toBe("production");
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("deletes a project env var", async () => {
    const response = await del(`/api/env-vars/${state.overrideVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: state.overrideVarId });
  });

  it("returns 404 for deleted env vars", async () => {
    const response = await get(`/api/env-vars/${state.overrideVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(404);
  });

  it("deletes a global env var", async () => {
    const response = await del(`/api/env-vars/${state.globalVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
  });
});
