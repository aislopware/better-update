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

  const assetContent = "console.log('hello from asset')";
  const assetHash = "aabbccdd11223344";
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

  // ── Section 2: Upload asset ────────────────────────────────────

  it("registers asset metadata", async () => {
    const response = await post(
      "/api/assets/upload",
      { assets: [{ hash: assetHash, contentType: assetContentType, fileExt: "js" }] },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toContain(assetHash);
  });

  it("uploads asset binary", async () => {
    const response = await put(`/api/assets/${assetHash}`, new TextEncoder().encode(assetContent), {
      cookie: cookies,
      "content-type": assetContentType,
      "content-length": new TextEncoder().encode(assetContent).byteLength.toString(),
    });
    expect(response.status).toBe(200);
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
