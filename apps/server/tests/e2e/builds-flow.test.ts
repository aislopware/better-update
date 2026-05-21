import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post, putAbsolute } = setupE2EWorker(".wrangler/state/e2e-builds");

// -- Tests -----------------------------------------------------------------

describe("Builds API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let buildId: string;
  let uploadUrl: string;
  let uploadHeaders: Record<string, string>;
  let uploadExpiresAt: string;
  let mismatchBuildId: string;
  let mismatchUploadUrl: string;
  let mismatchUploadHeaders: Record<string, string>;

  const artifactBytes = Buffer.from("e2e build artifact");
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const mismatchedArtifactBytes = Buffer.from("e2e mismatched build artifact");

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
      { name: "Build Test Project", slug: "build-test" },
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
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    buildId = body.id;
    uploadUrl = body.uploadUrl;
    uploadHeaders = body.uploadHeaders as Record<string, string>;
    uploadExpiresAt = body.uploadExpiresAt;
    expect(buildId).toBeDefined();
    expect(body.uploadMode).toBe("single");
    expect(body.uploadUrl).toBeDefined();
    expect(body.uploadExpiresAt).toBeDefined();
    expect(body.uploadHeaders).toEqual(
      expect.objectContaining({
        "content-type": "application/octet-stream",
        "x-amz-checksum-sha256": expect.any(String),
      }),
    );
  });

  it("rejects incompatible build reservations", async () => {
    const response = await post(
      "/api/builds",
      {
        projectId,
        platform: "android",
        distribution: "direct",
        artifactFormat: "aab",
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("uploads the artifact to the reserved URL", async () => {
    const response = await putAbsolute(uploadUrl, artifactBytes, {
      "content-length": String(artifactBytes.byteLength),
      ...uploadHeaders,
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
    const bodyText = await response.text();
    if (response.status !== 200) {
      throw new Error(`Expected build completion to succeed, got ${response.status}: ${bodyText}`);
    }
    const body = JSON.parse(bodyText);
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
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    mismatchBuildId = body.id as string;
    mismatchUploadUrl = body.uploadUrl as string;
    mismatchUploadHeaders = body.uploadHeaders as Record<string, string>;
  });

  it("rejects artifact upload when bytes do not match the signed SHA-256 checksum", async () => {
    const response = await putAbsolute(mismatchUploadUrl, mismatchedArtifactBytes, {
      "content-length": String(mismatchedArtifactBytes.byteLength),
      ...mismatchUploadHeaders,
    });
    expect(response.status).toBe(400);
  });

  it("rejects build completion when the completion payload does not match the reserved artifact", async () => {
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
        message: expect.stringContaining("reserved artifact metadata"),
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
    expect(body.page).toBe(1);
    expect(body.total).toBeGreaterThan(0);
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

  it("paginates builds via page+limit with stable order", async () => {
    const extraBuildIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const reserve = await post(
        "/api/builds",
        {
          projectId,
          platform: "ios",
          distribution: "ad-hoc",
          artifactFormat: "ipa",
          appVersion: `1.0.${i + 1}`,
          buildNumber: `${100 + i}`,
          bundleId: "com.test.app",
          message: `Page pagination build ${i}`,
          sha256: artifactSha256,
          byteSize: artifactBytes.byteLength,
        },
        { cookie: cookies },
      );
      expect(reserve.status).toBe(201);
      const reserveBody = await reserve.json();
      extraBuildIds.push(reserveBody.id);

      const upload = await putAbsolute(reserveBody.uploadUrl, artifactBytes, {
        "content-length": String(artifactBytes.byteLength),
        ...(reserveBody.uploadHeaders as Record<string, string>),
      });
      expect(upload.status).toBe(200);

      const complete = await post(
        `/api/builds/${reserveBody.id}/complete`,
        { sha256: artifactSha256, byteSize: artifactBytes.byteLength },
        { cookie: cookies },
      );
      expect(complete.status).toBe(200);
    }

    const firstResponse = await get(`/api/builds?projectId=${projectId}&limit=2&page=1`, {
      cookie: cookies,
    });
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.page).toBe(1);
    expect(firstBody.total).toBeGreaterThan(2);

    const secondResponse = await get(`/api/builds?projectId=${projectId}&limit=2&page=2`, {
      cookie: cookies,
    });
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.items.length).toBeGreaterThan(0);
    expect(secondBody.page).toBe(2);

    const firstIds = new Set(firstBody.items.map((build: { id: string }) => build.id));
    const secondIds = secondBody.items.map((build: { id: string }) => build.id);
    secondIds.forEach((id: string) => {
      expect(firstIds.has(id)).toBe(false);
    });
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

    // The signed artifact route (/api/builds/:id/artifact?token=…) 302-redirects
    // to a presigned R2 GET. worker.fetch doesn't auto-follow, so run the worker
    // hop through the pool, then fetch the R2 location directly (workerd outbound).
    const artifact = new URL(links.artifactUrl, "http://localhost");
    const redirect = await get(`${artifact.pathname}${artifact.search}`);
    expect(redirect.status).toBe(302);
    const artifactResponse = await fetch(redirect.headers.get("location") ?? "");
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
