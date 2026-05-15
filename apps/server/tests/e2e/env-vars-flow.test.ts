import { setupE2EWorker } from "../helpers/e2e-worker";

const { del, get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-env-vars");

describe("Environment variables API flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    globalVarId: "",
    sensitiveVarId: "",
    plaintextVarId: "",
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

  it("creates a global plaintext env var", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "global",
        environments: ["development", "preview", "production"],
        key: "EXPO_PUBLIC_API_URL",
        value: "https://global.example.com",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.globalVarId = body.id;
    expect(body.scope).toBe("global");
    expect(body.projectId).toBeNull();
    expect(body.value).toBe("https://global.example.com");
    expect(body.environments).toEqual(["development", "preview", "production"]);
  });

  it("rejects global env var with projectId", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "global",
        projectId: state.projectId,
        environments: ["production"],
        key: "BAD_GLOBAL",
        value: "x",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(400);
  });

  it("creates a project sensitive env var assigned to multiple environments", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["preview", "production"],
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
    expect(body.environments).toEqual(["preview", "production"]);
  });

  it("creates a project plaintext env var that overrides global", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["production"],
        key: "EXPO_PUBLIC_API_URL",
        value: "https://project.example.com",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.plaintextVarId = body.id;
    expect(body.scope).toBe("project");
    expect(body.value).toBe("https://project.example.com");
  });

  it("rejects duplicate project key", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["development"],
        key: "EXPO_PUBLIC_API_URL",
        value: "another",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects secret visibility (no longer supported)", async () => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["production"],
        key: "OLD_SECRET",
        value: "x",
        visibility: "secret",
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
      value: string;
      overridesGlobal?: boolean;
    };
    expect(apiUrl.scope).toBe("project");
    expect(apiUrl.value).toBe("https://project.example.com");
    expect(apiUrl.overridesGlobal).toBe(true);

    const sentry = byKey.get("SENTRY_AUTH_TOKEN") as { scope: string; value: string };
    expect(sentry.scope).toBe("project");
    expect(sentry.value).toBe("••••••");
  });

  it("filters by environments", async () => {
    const response = await get(
      `/api/env-vars?projectId=${state.projectId}&scope=project&environments=preview`,
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.items.map((item: { key: string }) => item.key);
    expect(keys).toEqual(["SENTRY_AUTH_TOKEN"]);
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

  it("reassigns environments via PATCH", async () => {
    const response = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { environments: ["development", "production"] },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environments).toEqual(["development", "production"]);
  });

  it("bulk imports project env vars with multi-env assignment", async () => {
    const response = await post(
      "/api/env-vars/bulk-import",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["development", "production"],
        visibility: "sensitive",
        content: `
# duplicate APP_TOKEN, last value wins
APP_TOKEN=rotated-1
EXPO_PUBLIC_WEB_URL=https://prod.example.com
APP_TOKEN=rotated-2
`.trim(),
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ created: 2, updated: 0, skipped: 1 });
  });

  it("rejects export with session auth", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { cookie: state.cookies },
    );
    expect(response.status).toBe(403);
  });

  it("exports merged env vars (project overrides global) with API key auth", async () => {
    const response = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { authorization: `Bearer ${state.apiKey}` },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.environment).toBe("production");
    const byKey = new Map(body.items.map((item: { key: string }) => [item.key, item]));
    expect(byKey.get("APP_TOKEN")).toEqual({
      key: "APP_TOKEN",
      value: "rotated-2",
      visibility: "sensitive",
    });
    expect(byKey.get("EXPO_PUBLIC_API_URL")).toEqual({
      key: "EXPO_PUBLIC_API_URL",
      value: "https://project.example.com",
      visibility: "plaintext",
    });
    expect(byKey.get("EXPO_PUBLIC_WEB_URL")).toEqual({
      key: "EXPO_PUBLIC_WEB_URL",
      value: "https://prod.example.com",
      visibility: "sensitive",
    });
  });

  it("deletes a project env var", async () => {
    const response = await del(`/api/env-vars/${state.plaintextVarId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: state.plaintextVarId });
  });

  it("returns 404 for deleted env vars", async () => {
    const response = await get(`/api/env-vars/${state.plaintextVarId}`, {
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
