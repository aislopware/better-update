import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-credentials");

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, headers ? { headers } : {});

const del = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, { method: "DELETE", ...(headers ? { headers } : {}) });

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

describe("Credentials API flow", () => {
  const state = {
    cookies: "",
    organizationId: "",
    projectId: "",
    apiKey: "",
    credentialId: "",
  };

  const blobBase64 = Buffer.from("fake-p12-binary").toString("base64");
  const metadata = JSON.stringify({
    commonName: "Apple Distribution: Better Update",
    teamId: "TEAM123456",
  });

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Credential User",
      email: "credentials-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response);
    expect(state.cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Credential Org", slug: "credential-org" },
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
      { name: "Credential Project", slug: "credentials-app" },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.projectId = body.id;
  });

  it("creates an API key for download auth", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "credential-download-key", organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    state.apiKey = body.key;
  });

  it("uploads a credential", async () => {
    const response = await post(
      "/api/credentials",
      {
        projectId: state.projectId,
        platform: "ios",
        type: "distribution-certificate",
        name: "iOS Distribution Certificate",
        blob: blobBase64,
        password: "cert-password",
        metadata,
        expiresAt: "2027-04-11T00:00:00.000Z",
      },
      { cookie: state.cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    state.credentialId = body.id;
    expect(body.name).toBe("iOS Distribution Certificate");
    expect(body.projectId).toBe(state.projectId);
    expect(body.isActive).toBe(false);
    expect(body.metadata).toBe(metadata);
    expect(body.expiresAt).toBe("2027-04-11T00:00:00.000Z");
  });

  it("lists uploaded credentials", async () => {
    const response = await get(`/api/credentials?projectId=${state.projectId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(state.credentialId);
  });

  it("gets a credential by id", async () => {
    const response = await get(`/api/credentials/${state.credentialId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(state.credentialId);
    expect(body.metadata).toBe(metadata);
    expect(body.isActive).toBe(false);
  });

  it("activates the credential", async () => {
    const response = await post(
      `/api/credentials/${state.credentialId}/activate`,
      {},
      { cookie: state.cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(state.credentialId);
    expect(body.isActive).toBe(true);
  });

  it("rejects credential download with session auth", async () => {
    const response = await get(`/api/credentials/${state.credentialId}/download`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(403);
  });

  it("downloads and decrypts the credential with API key auth", async () => {
    const response = await get(`/api/credentials/${state.credentialId}/download`, {
      authorization: `Bearer ${state.apiKey}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      blob: blobBase64,
      password: "cert-password",
      keyAlias: null,
      keyPassword: null,
      filename: "cert.p12",
      contentType: "application/x-pkcs12",
    });
  });

  it("deletes the credential", async () => {
    const response = await del(`/api/credentials/${state.credentialId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: state.credentialId });
  });

  it("returns 404 after credential deletion", async () => {
    const response = await get(`/api/credentials/${state.credentialId}`, {
      cookie: state.cookies,
    });
    expect(response.status).toBe(404);
  });
});
