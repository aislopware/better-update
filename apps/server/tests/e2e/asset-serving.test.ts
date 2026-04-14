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

const put = (path: string, body: BodyInit, headers?: Record<string, string>) =>
  fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers,
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
  let uploadToken: string;

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
      { name: "Asset Test Project", scopeKey: "@asset/test" },
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
        uploadToken: expect.any(String),
      }),
    ]);
    uploadToken = body.uploaded[0]?.uploadToken as string;
  });

  it("rejects binary upload without a scoped upload token", async () => {
    const response = await put(`/api/assets/${assetHash}`, new TextEncoder().encode(assetContent), {
      "content-type": assetContentType,
      "content-length": new TextEncoder().encode(assetContent).byteLength.toString(),
    });
    expect(response.status).toBe(401);
  });

  it("uploads asset binary", async () => {
    const response = await put(`/api/assets/${assetHash}`, new TextEncoder().encode(assetContent), {
      "x-better-update-upload-token": uploadToken,
      "content-type": assetContentType,
      "content-length": new TextEncoder().encode(assetContent).byteLength.toString(),
    });
    expect(response.status).toBe(200);
  });

  it("rejects binary upload when the body hash does not match the registered hash", async () => {
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
    const mismatchedUploadToken = registerBody.uploaded[0]?.uploadToken as string;

    const uploadResponse = await put(
      `/api/assets/${mismatchedHash}`,
      new TextEncoder().encode(unexpectedContent),
      {
        "x-better-update-upload-token": mismatchedUploadToken,
        "content-type": assetContentType,
        "content-length": new TextEncoder().encode(unexpectedContent).byteLength.toString(),
      },
    );
    expect(uploadResponse.status).toBe(400);
    expect(await uploadResponse.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("Asset hash mismatch"),
      }),
    );
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
