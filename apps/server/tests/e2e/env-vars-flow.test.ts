import { setupE2EWorker } from "../helpers/e2e-worker";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-env-vars");

describe("Environment variables API flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    sharedVarId: "",
    sensitiveVarId: "",
    secretVarId: "",
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

  it("creates a shared plaintext env var", async () => {
    const response = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "*",
        key: "EXPO_PUBLIC_API_URL",
        value: "https://shared.example.com",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.sharedVarId = body.id;
    expect(body.value).toBe("https://shared.example.com");
  });

  it("creates a production sensitive env var", async () => {
    const response = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "production",
        key: "SENTRY_AUTH_TOKEN",
        value: "sentry-token-1",
        visibility: "sensitive",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.sensitiveVarId = body.id;
    expect(body.value).toBe("••••••");
    expect(body.visibility).toBe("sensitive");
  });

  it("creates a production secret env var", async () => {
    const response = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "production",
        key: "APP_SECRET",
        value: "super-secret",
        visibility: "secret",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.secretVarId = body.id;
    expect(body.value).toBeNull();
    expect(body.visibility).toBe("secret");
  });

  it("rejects duplicate keys in the same environment", async () => {
    const response = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "production",
        key: "APP_SECRET",
        value: "another-secret",
        visibility: "secret",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(409);
  });

  it("lists production env vars with masked values", async () => {
    const response = await get(
      `/api/env-vars?projectId=${state.projectId}&environment=production`,
      {
        cookie: state.cookies,
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item: { key: string }) => item.key)).toEqual([
      "APP_SECRET",
      "SENTRY_AUTH_TOKEN",
    ]);
    const secretItem = body.items.find((item: { key: string }) => item.key === "APP_SECRET");
    const sensitiveItem = body.items.find(
      (item: { key: string }) => item.key === "SENTRY_AUTH_TOKEN",
    );
    expect(secretItem.value).toBeNull();
    expect(sensitiveItem.value).toBe("••••••");
  });

  it("gets a secret env var with hidden value", async () => {
    const response = await get(`/api/env-vars/${state.secretVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toBe("APP_SECRET");
    expect(body.value).toBeNull();
  });

  it("updates a sensitive env var to plaintext using the stored secret", async () => {
    const response = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { visibility: "plaintext" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.visibility).toBe("plaintext");
    expect(body.value).toBe("sentry-token-1");
  });

  it("bulk imports production env vars with dedupe", async () => {
    const response = await post(
      "/api/env-vars/bulk-import",
      {
        projectId: state.projectId,
        environment: "production",
        visibility: "secret",
        content: `
# duplicate APP_SECRET, last value wins
APP_SECRET=rotated-secret-1
EXPO_PUBLIC_WEB_URL=https://prod.example.com
APP_SECRET=rotated-secret-2
`.trim(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ created: 1, updated: 1, skipped: 1 });
  });

  it("rejects export with session auth", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      {
        cookie: state.cookies,
      },
    );
    expect(response.status).toBe(403);
  });

  it("exports merged env vars with API key auth", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      {
        authorization: `Bearer ${state.apiKey}`,
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environment).toBe("production");
    expect(body.items).toEqual([
      {
        key: "APP_SECRET",
        value: "rotated-secret-2",
        visibility: "secret",
      },
      {
        key: "EXPO_PUBLIC_API_URL",
        value: "https://shared.example.com",
        visibility: "plaintext",
      },
      {
        key: "EXPO_PUBLIC_WEB_URL",
        value: "https://prod.example.com",
        visibility: "secret",
      },
      {
        key: "SENTRY_AUTH_TOKEN",
        value: "sentry-token-1",
        visibility: "plaintext",
      },
    ]);
  });

  it("deletes a secret env var", async () => {
    const response = await del(`/api/env-vars/${state.secretVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: state.secretVarId });
  });

  it("returns 404 for deleted env vars", async () => {
    const response = await get(`/api/env-vars/${state.secretVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(404);
  });
});
