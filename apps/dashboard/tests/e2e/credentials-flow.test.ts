import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, del, parseCookies } = setupE2EDashboard(".wrangler/state/e2e-dash-credentials");

describe("Dashboard credentials flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    credentialId: "",
  };

  const blobBase64 = Buffer.from("dashboard-fake-p12").toString("base64");

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Dashboard Credential User",
      email: "dashboard-credentials@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response);
    expect(state.cookies.length > 0).toBe(true);
  });

  it("creates and activates an organization", async () => {
    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Dashboard Credential Org", slug: "dashboard-credential-org" },
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

  it("creates a project and API key", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Dashboard Credential Project", scopeKey: "@dashboard/credentials" },
      { cookie: state.cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    const createProjectBody = await createProjectResponse.json();
    state.projectId = createProjectBody.id;

    const createKeyResponse = await post(
      "/api/auth/api-key/create",
      { name: "dashboard-credential-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(createKeyResponse.status).toBe(200);
    const createKeyBody = await createKeyResponse.json();
    state.apiKey = createKeyBody.key;
  });

  it("uploads, lists, activates, downloads, and deletes a credential through dashboard proxy", async () => {
    const uploadResponse = await post(
      "/api/credentials",
      {
        projectId: state.projectId,
        platform: "ios",
        type: "distribution-certificate",
        name: "Dashboard Distribution Certificate",
        blob: blobBase64,
        password: "dashboard-password",
        metadata: JSON.stringify({
          commonName: "Apple Distribution: Dashboard",
          teamId: "TEAMDASH",
        }),
        expiresAt: "2027-05-01T00:00:00.000Z",
      },
      { cookie: state.cookies },
    );
    expect(uploadResponse.status).toBe(201);
    const uploadBody = await uploadResponse.json();
    state.credentialId = uploadBody.id;

    const listResponse = await get(`/api/credentials?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json();
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: state.credentialId,
          name: "Dashboard Distribution Certificate",
          isActive: false,
        }),
      ]),
    );

    const activateResponse = await post(
      `/api/credentials/${state.credentialId}/activate`,
      {},
      { cookie: state.cookies },
    );
    expect(activateResponse.status).toBe(200);
    const activateBody = await activateResponse.json();
    expect(activateBody).toEqual(
      expect.objectContaining({
        id: state.credentialId,
        isActive: true,
      }),
    );

    const downloadResponse = await get(`/api/credentials/${state.credentialId}/download`, {
      authorization: `Bearer ${state.apiKey}`,
    });
    expect(downloadResponse.status).toBe(200);
    const downloadBody = await downloadResponse.json();
    expect(downloadBody).toEqual(
      expect.objectContaining({
        blob: blobBase64,
        password: "dashboard-password",
      }),
    );

    const deleteResponse = await del(`/api/credentials/${state.credentialId}`, undefined, {
      cookie: state.cookies,
    });
    expect(deleteResponse.status).toBe(200);

    const getDeletedResponse = await get(`/api/credentials/${state.credentialId}`, {
      cookie: state.cookies,
    });
    expect(getDeletedResponse.status).toBe(404);
  });
});
