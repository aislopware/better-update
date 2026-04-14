import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-builds");

// -- Helpers ---------------------------------------------------------------

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, headers ? { headers } : {});

const putAbsolute = (url: string, body: BodyInit, headers?: Record<string, string>) =>
  fetch(url, {
    method: "PUT",
    ...(headers ? { headers } : {}),
    body,
  });

const del = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, { method: "DELETE", ...(headers ? { headers } : {}) });

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

// -- Tests -----------------------------------------------------------------

describe("Builds API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let buildId: string;
  let uploadUrl: string;
  let uploadExpiresAt: string;
  let mismatchBuildId: string;
  let mismatchUploadUrl: string;

  const artifactBytes = Buffer.from("e2e build artifact");
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");

  // -- Auth bootstrap -------------------------------------------------------

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Build E2E User",
      email: "build-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Build Org", slug: "build-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    organizationId = body.id;
    cookies = parseCookies(response) || cookies;
  });

  it("sets the organization as active", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    cookies = parseCookies(response) || cookies;
  });

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Build Test Project", scopeKey: "@build/test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    projectId = body.id;
    expect(projectId).toBeDefined();
  });

  // -- Builds CRUD ----------------------------------------------------------

  it("reserves a build and gets an upload URL", async () => {
    const response = await post(
      "/api/builds",
      {
        projectId,
        platform: "ios",
        distribution: "ad-hoc",
        artifactFormat: "ipa",
        appVersion: "1.0.0",
        buildNumber: "42",
        bundleId: "com.test.app",
        message: "E2E test build",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    buildId = body.id;
    uploadUrl = body.uploadUrl;
    uploadExpiresAt = body.uploadExpiresAt;
    expect(buildId).toBeDefined();
    expect(body.uploadUrl).toBeDefined();
    expect(body.uploadExpiresAt).toBeDefined();
  });

  it("rejects incompatible build reservations", async () => {
    const response = await post(
      "/api/builds",
      {
        projectId,
        platform: "android",
        distribution: "direct",
        artifactFormat: "aab",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("uploads the artifact to the reserved URL", async () => {
    const response = await putAbsolute(uploadUrl, artifactBytes, {
      "content-type": "application/octet-stream",
      "content-length": String(artifactBytes.byteLength),
    });
    expect(response.status).toBe(200);
  });

  it("completes the build after upload", async () => {
    const response = await post(
      `/api/builds/${buildId}/complete`,
      {
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        id: buildId,
        message: "E2E test build",
        artifact: expect.objectContaining({
          sha256: artifactSha256,
          byteSize: artifactBytes.byteLength,
          format: "ipa",
        }),
      }),
    );
  });

  it("reserves another build for integrity validation", async () => {
    const response = await post(
      "/api/builds",
      {
        projectId,
        platform: "android",
        distribution: "direct",
        artifactFormat: "apk",
        appVersion: "1.0.0",
        buildNumber: "43",
        bundleId: "com.test.app",
        message: "Integrity check build",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    mismatchBuildId = body.id as string;
    mismatchUploadUrl = body.uploadUrl as string;
  });

  it("uploads a second artifact to staging", async () => {
    const response = await putAbsolute(mismatchUploadUrl, artifactBytes, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(artifactBytes.byteLength),
    });
    expect(response.status).toBe(200);
  });

  it("rejects build completion when sha256 does not match the uploaded artifact", async () => {
    const response = await post(
      `/api/builds/${mismatchBuildId}/complete`,
      {
        sha256: "0".repeat(64),
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("Artifact SHA-256 mismatch"),
      }),
    );
  });

  it("lists builds for the project", async () => {
    const response = await get(`/api/builds?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toBeDefined();
    expect(body.total).toBeDefined();
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: buildId,
          artifact: expect.objectContaining({
            sha256: artifactSha256,
          }),
        }),
      ]),
    );
  });

  it("gets the completed build by id", async () => {
    const response = await get(`/api/builds/${buildId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        id: buildId,
        artifact: expect.objectContaining({
          sha256: artifactSha256,
          byteSize: artifactBytes.byteLength,
        }),
      }),
    );
  });

  it("returns 404 for a non-existent build", async () => {
    const response = await get("/api/builds/non-existent-id", {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("returns 401 for unauthenticated build artifact download", async () => {
    const testId = buildId ?? "fake-build-id";
    const response = await get(`/api/builds/${testId}/artifact`);
    expect(response.status).toBe(401);
  });

  it("returns 401 for install plist without signed token", async () => {
    const testId = buildId ?? "fake-build-id";
    const response = await get(`/api/builds/${testId}/install`);
    expect(response.status).toBe(401);
  });

  it("serves signed artifact download and install metadata for completed builds", async () => {
    const linkResponse = await get(`/api/builds/${buildId}/install-link`, {
      cookie: cookies,
    });
    expect(linkResponse.status).toBe(200);
    const links = await linkResponse.json();
    expect(links.artifactUrl).toContain(`/api/builds/${buildId}/artifact?token=`);
    expect(links.installUrl).toContain("itms-services://?action=download-manifest");
    expect(uploadExpiresAt).toBeTruthy();

    const artifactResponse = await fetch(links.artifactUrl);
    expect(artifactResponse.status).toBe(200);
    expect([...new Uint8Array(await artifactResponse.arrayBuffer())]).toEqual([...artifactBytes]);

    const plistResponse = await get(
      `/api/builds/${buildId}/install?token=${String(links.token)}&expires=${String(links.expires)}`,
    );
    expect(plistResponse.status).toBe(200);
    const plist = await plistResponse.text();
    expect(plist).toContain("software-package");
    expect(plist).toContain("com.test.app");
  });

  it("deletes the build and its artifact record", async () => {
    const response = await del(`/api/builds/${buildId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });

    const getDeletedResponse = await get(`/api/builds/${buildId}`, {
      cookie: cookies,
    });
    expect(getDeletedResponse.status).toBe(404);
  });
});
