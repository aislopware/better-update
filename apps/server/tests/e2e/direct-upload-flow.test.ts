import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

/**
 * The ONLY e2e file that exercises the real presigned-URL path against real R2
 * (runs on the `e2e-pool-r2` project, R2 binding `remote: true`). It is the
 * counterpart to the local seed-based flows: anything that merely *needs* an
 * asset/artifact to exist seeds local R2 and runs on `e2e-pool`; this file keeps
 * only what miniflare cannot simulate — the direct-to-R2 PUT/GET contract and
 * R2's server-side `x-amz-checksum-sha256` enforcement. Keep it minimal.
 */
const { get, parseCookies, post, postNoBody, putAbsolute } = setupE2EWorker(
  ".wrangler/state/e2e-direct-upload",
);

describe("Direct R2 upload contract (real R2)", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;

  // ── Auth bootstrap ─────────────────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Direct Upload User",
      email: "direct-upload-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Direct Upload Org", slug: "direct-upload-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    organizationId = (await response.json()).id;
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
      { name: "Direct Upload Project", slug: "direct-upload" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    projectId = (await response.json()).id as string;
  });

  // ── Asset: presigned PUT → finalize-reads-real-checksum → mismatch 400 ──

  describe("asset direct upload", () => {
    const assetContent = "console.log('hello from asset')";
    const assetHash = createHash("sha256").update(assetContent).digest("base64url");
    const assetContentType = "application/javascript";
    let uploadUrl: string;
    let uploadHeaders: Record<string, string>;

    it("registers asset metadata", async () => {
      const response = await post(
        "/api/assets/upload",
        {
          projectId,
          assets: [{ hash: assetHash, contentType: assetContentType, fileExt: "js" }],
        },
        { cookie: cookies },
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.uploaded).toEqual([
        expect.objectContaining({
          hash: assetHash,
          uploadMode: "single",
          uploadUrl: expect.any(String),
          uploadHeaders: expect.objectContaining({
            "content-type": assetContentType,
            "x-amz-checksum-sha256": expect.any(String),
          }),
        }),
      ]);
      uploadUrl = body.uploaded[0]?.uploadUrl as string;
      uploadHeaders = body.uploaded[0]?.uploadHeaders as Record<string, string>;
    });

    it("uploads asset binary to the presigned URL", async () => {
      const bytes = new TextEncoder().encode(assetContent);
      const response = await putAbsolute(uploadUrl, bytes, {
        "content-length": bytes.byteLength.toString(),
        ...uploadHeaders,
      });
      expect(response.status).toBe(200);
    });

    it("finalizes asset upload from the real R2 checksum", async () => {
      const response = await postNoBody(`/api/assets/${assetHash}/finalize`, { cookie: cookies });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        expect.objectContaining({
          hash: assetHash,
          contentType: assetContentType,
          byteSize: new TextEncoder().encode(assetContent).byteLength,
        }),
      );
    });

    it("rejects direct upload when bytes do not match the signed hash", async () => {
      const expectedContent = "console.log('expected')";
      const unexpectedContent = "console.log('unexpected')";
      const mismatchedHash = createHash("sha256").update(expectedContent).digest("base64url");

      const registerResponse = await post(
        "/api/assets/upload",
        {
          projectId,
          assets: [{ hash: mismatchedHash, contentType: assetContentType, fileExt: "js" }],
        },
        { cookie: cookies },
      );
      expect(registerResponse.status).toBe(201);
      const registerBody = await registerResponse.json();
      const mismatchedUploadUrl = registerBody.uploaded[0]?.uploadUrl as string;
      const mismatchedUploadHeaders = registerBody.uploaded[0]?.uploadHeaders as Record<
        string,
        string
      >;

      const uploadResponse = await putAbsolute(
        mismatchedUploadUrl,
        new TextEncoder().encode(unexpectedContent),
        {
          "content-length": new TextEncoder().encode(unexpectedContent).byteLength.toString(),
          ...mismatchedUploadHeaders,
        },
      );
      expect(uploadResponse.status).toBe(400);
    });
  });

  // ── Build: presigned PUT → complete → signed GET download → mismatch 400 ──

  describe("build artifact direct upload", () => {
    const artifactBytes = Buffer.from("e2e build artifact");
    const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
    const mismatchedArtifactBytes = Buffer.from("e2e mismatched build artifact");
    let buildId: string;
    let uploadUrl: string;
    let uploadHeaders: Record<string, string>;
    let uploadExpiresAt: string;

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
          message: "E2E direct-upload build",
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
      expect(body.uploadMode).toBe("single");
      expect(body.uploadHeaders).toEqual(
        expect.objectContaining({
          "content-type": "application/octet-stream",
          "x-amz-checksum-sha256": expect.any(String),
        }),
      );
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
        { sha256: artifactSha256, byteSize: artifactBytes.byteLength },
        { cookie: cookies },
      );
      const bodyText = await response.text();
      if (response.status !== 200) {
        throw new Error(
          `Expected build completion to succeed, got ${response.status}: ${bodyText}`,
        );
      }
      expect(JSON.parse(bodyText)).toEqual(
        expect.objectContaining({
          id: buildId,
          artifact: expect.objectContaining({ sha256: artifactSha256, format: "ipa" }),
        }),
      );
    });

    it("serves signed artifact download with the uploaded bytes", async () => {
      const linkResponse = await get(`/api/builds/${buildId}/install-link`, { cookie: cookies });
      expect(linkResponse.status).toBe(200);
      const links = await linkResponse.json();
      expect(links.artifactUrl).toContain(`/api/builds/${buildId}/artifact?token=`);
      expect(links.installUrl).toContain("itms-services://?action=download-manifest");
      expect(uploadExpiresAt).toBeTruthy();

      // The signed artifact route 302-redirects to a presigned R2 GET. worker.fetch
      // doesn't auto-follow, so run the worker hop through the pool, then fetch the
      // R2 location directly (workerd outbound).
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

    it("rejects artifact upload when bytes do not match the signed SHA-256 checksum", async () => {
      const reserve = await post(
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
      expect(reserve.status).toBe(201);
      const reserveBody = await reserve.json();

      const response = await putAbsolute(reserveBody.uploadUrl, mismatchedArtifactBytes, {
        "content-length": String(mismatchedArtifactBytes.byteLength),
        ...(reserveBody.uploadHeaders as Record<string, string>),
      });
      expect(response.status).toBe(400);
    });
  });
});
