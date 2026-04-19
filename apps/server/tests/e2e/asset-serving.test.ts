import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker";

const { getBaseUrl } = setupE2EWorker(".wrangler/state/e2e-asset-serving");

// ── Helpers ───────────────────────────────────────────────────────

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const postNoBody = (path: string, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    ...(headers ? { headers } : {}),
  });

const putAbsolute = (url: string, body: BodyInit, headers?: Record<string, string>) =>
  fetch(url, {
    method: "PUT",
    ...(headers ? { headers } : {}),
    body,
  });

const get = (path: string) => fetch(`${getBaseUrl()}${path}`);

const parseCookies = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

// ── Asset Serving E2E ───────────────────────────────────────────

describe("Asset serving flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let uploadUrl: string;
  let uploadHeaders: Record<string, string>;

  const assetContent = "console.log('hello from asset')";
  const assetHash = createHash("sha256").update(assetContent).digest("base64url");
  const assetContentType = "application/javascript";

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Asset E2E User",
      email: "asset-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Asset Org", slug: "asset-org" },
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
      { name: "Asset Test Project", slug: "asset-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    projectId = (await response.json()).id as string;
  });

  // ── Section 2: Upload asset ────────────────────────────────────

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

  it("uploads asset binary", async () => {
    const bytes = new TextEncoder().encode(assetContent);
    const response = await putAbsolute(uploadUrl, bytes, {
      "content-length": bytes.byteLength.toString(),
      ...uploadHeaders,
    });
    expect(response.status).toBe(200);
  });

  it("finalizes asset upload", async () => {
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

  // ── Section 3: Serve asset ─────────────────────────────────────

  it("serves asset via GET /assets/:hash", async () => {
    const response = await get(`/assets/${assetHash}`);
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toBe(assetContent);

    expect(response.headers.get("content-type")).toBe(assetContentType);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBeTruthy();
  });

  it("returns 404 for non-existent asset", async () => {
    const response = await get("/assets/0000000000000000");
    expect(response.status).toBe(404);
  });
});
