import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, patch, del, parseCookies } = setupE2EDashboard();

describe("dashboard environment variables flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    globalVarId: "",
    sensitiveVarId: "",
    plaintextVarId: "",
  };

  const createProjectEnvVar = async ({
    key,
    value,
    visibility,
    environments,
  }: {
    key: string;
    value: string;
    visibility: "sensitive" | "plaintext";
    environments: readonly ("development" | "preview" | "production")[];
  }) => {
    const response = await post(
      "/api/env-vars",
      {
        scope: "project",
        projectId: state.projectId,
        environments,
        key,
        value,
        visibility,
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    return response.json();
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

  it("creates a project and export API key", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Dashboard Env Project", slug: "dashboard-env" },
      { cookie: state.cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    const createProjectBody = await createProjectResponse.json();
    state.projectId = createProjectBody.id;

    const createKeyResponse = await post(
      "/api/auth/api-key/create",
      { name: "dashboard-env-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(createKeyResponse.status).toBe(200);
    const createKeyBody = await createKeyResponse.json();
    state.apiKey = createKeyBody.key;
  });

  it("creates project + global env vars, imports, lists with override, exports, updates, deletes", async () => {
    const globalResponse = await post(
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
    expect(globalResponse.status).toBe(201);
    const globalBody = await globalResponse.json();
    state.globalVarId = globalBody.id;

    const sensitiveBody = await createProjectEnvVar({
      key: "SENTRY_AUTH_TOKEN",
      value: "sentry-token",
      visibility: "sensitive",
      environments: ["production"],
    });
    state.sensitiveVarId = sensitiveBody.id;

    const plaintextBody = await createProjectEnvVar({
      key: "EXPO_PUBLIC_API_URL",
      value: "https://project.example.com",
      visibility: "plaintext",
      environments: ["production"],
    });
    state.plaintextVarId = plaintextBody.id;

    const importResponse = await post(
      "/api/env-vars/bulk-import",
      {
        scope: "project",
        projectId: state.projectId,
        environments: ["production"],
        content: "FEATURE_FLAG=true\n",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(importResponse.status).toBe(200);
    const importBody = await importResponse.json();
    expect(importBody).toStrictEqual({ created: 1, updated: 0, skipped: 0 });

    const listResponse = await get(`/api/env-vars?projectId=${state.projectId}&scope=all`, {
      cookie: state.cookies,
    });
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const byKey = new Map(listBody.items.map((item: { key: string }) => [item.key, item]));
    expect(byKey.size).toBe(3);
    expect(byKey.get("EXPO_PUBLIC_API_URL")).toStrictEqual(
      expect.objectContaining({
        scope: "project",
        value: "https://project.example.com",
        overridesGlobal: true,
      }),
    );
    expect(byKey.get("SENTRY_AUTH_TOKEN")).toStrictEqual(
      expect.objectContaining({ value: "sentry-token", visibility: "sensitive" }),
    );

    const exportResponse = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { authorization: `Bearer ${state.apiKey}` },
    );
    expect(exportResponse.status).toBe(200);
    const exportBody = await exportResponse.json();
    const exportByKey = new Map(exportBody.items.map((item: { key: string }) => [item.key, item]));
    expect(exportByKey.get("EXPO_PUBLIC_API_URL")).toStrictEqual({
      key: "EXPO_PUBLIC_API_URL",
      value: "https://project.example.com",
      visibility: "plaintext",
    });
    expect(exportByKey.get("SENTRY_AUTH_TOKEN")).toStrictEqual({
      key: "SENTRY_AUTH_TOKEN",
      value: "sentry-token",
      visibility: "sensitive",
    });

    const updateResponse = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { visibility: "plaintext", environments: ["development", "production"] },
      { cookie: state.cookies },
    );
    expect(updateResponse.status).toBe(200);
    const updateBody = await updateResponse.json();
    expect(updateBody).toStrictEqual(
      expect.objectContaining({
        id: state.sensitiveVarId,
        visibility: "plaintext",
        value: "sentry-token",
        environments: ["development", "production"],
      }),
    );

    const deleteResponse = await del(`/api/env-vars/${state.plaintextVarId}`, undefined, {
      cookie: state.cookies,
    });
    expect(deleteResponse.status).toBe(200);
  });
});
