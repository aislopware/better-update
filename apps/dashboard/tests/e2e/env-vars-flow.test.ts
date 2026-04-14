import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, patch, del, parseCookies } = setupE2EDashboard(
  ".wrangler/state/e2e-dash-env-vars",
);

describe("Dashboard environment variables flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    secretVarId: "",
    sensitiveVarId: "",
  };

  const createEnvVar = async ({
    key,
    value,
    visibility,
  }: {
    key: string;
    value: string;
    visibility: "secret" | "sensitive" | "plaintext";
  }) => {
    const response = await post(
      "/api/env-vars",
      {
        projectId: state.projectId,
        environment: "production",
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
      { name: "Dashboard Env Project", scopeKey: "@dashboard/env" },
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

  it("creates, imports, exports, updates, and deletes env vars", async () => {
    const createSecretBody = await createEnvVar({
      key: "APP_SECRET",
      value: "super-secret",
      visibility: "secret",
    });
    state.secretVarId = createSecretBody.id;

    const createSensitiveBody = await createEnvVar({
      key: "SENTRY_AUTH_TOKEN",
      value: "sentry-token",
      visibility: "sensitive",
    });
    state.sensitiveVarId = createSensitiveBody.id;

    const importResponse = await post(
      "/api/env-vars/bulk-import",
      {
        projectId: state.projectId,
        environment: "production",
        content: "EXPO_PUBLIC_API_URL=https://api.example.com\nFEATURE_FLAG=true\n",
        visibility: "plaintext",
      },
      { cookie: state.cookies },
    );
    expect(importResponse.status).toBe(200);
    const importBody = await importResponse.json();
    expect(importBody).toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
    });

    const listResponse = await get(
      `/api/env-vars?projectId=${state.projectId}&environment=production`,
      {
        cookie: state.cookies,
      },
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "APP_SECRET", value: null, visibility: "secret" }),
        expect.objectContaining({
          key: "SENTRY_AUTH_TOKEN",
          value: "••••••",
          visibility: "sensitive",
        }),
        expect.objectContaining({
          key: "EXPO_PUBLIC_API_URL",
          value: "https://api.example.com",
          visibility: "plaintext",
        }),
      ]),
    );

    const exportResponse = await get(
      `/api/env-vars/export?projectId=${state.projectId}&environment=production`,
      { authorization: `Bearer ${state.apiKey}` },
    );
    expect(exportResponse.status).toBe(200);
    const exportBody = await exportResponse.json();
    expect(exportBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "APP_SECRET", value: "super-secret" }),
        expect.objectContaining({ key: "SENTRY_AUTH_TOKEN", value: "sentry-token" }),
      ]),
    );

    const updateResponse = await patch(
      `/api/env-vars/${state.sensitiveVarId}`,
      { visibility: "plaintext" },
      { cookie: state.cookies },
    );
    expect(updateResponse.status).toBe(200);
    const updateBody = await updateResponse.json();
    expect(updateBody).toEqual(
      expect.objectContaining({
        id: state.sensitiveVarId,
        visibility: "plaintext",
        value: "sentry-token",
      }),
    );

    const deleteResponse = await del(`/api/env-vars/${state.secretVarId}`, undefined, {
      cookie: state.cookies,
    });
    expect(deleteResponse.status).toBe(200);
  });
});
