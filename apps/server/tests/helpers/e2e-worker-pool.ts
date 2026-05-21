import { createHash } from "node:crypto";

import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

/**
 * E2E HTTP client backed by `@cloudflare/vitest-pool-workers`: requests are
 * dispatched straight into the worker's `fetch` handler (full middleware +
 * handler stack) against local D1/R2/KV — no real HTTP server, no wrangler, no
 * Cloudflare auth. `waitOnExecutionContext` drains the request's `ctx.waitUntil`
 * promises before returning, so background writes (audit logs, etc.) are
 * observable by the next request — these e2e files chain state across requests.
 *
 * The interface mirrors `./e2e-worker` so a test file ports across by swapping
 * only the import. `persistDir` is accepted and ignored for that source
 * compatibility. `putAbsolute` targets an external presigned R2 URL, so it uses
 * the runtime's outbound `fetch` (workerd allows subrequests) rather than routing
 * through the worker — used only by `direct-upload-flow.test.ts` on the
 * `e2e-pool-r2` project (R2 binding `remote: true` → real `*-e2e` bucket). Local
 * flows on `e2e-pool` use `seedAssetObject` instead.
 *
 * `BASE` matches the project's `BETTER_AUTH_URL` so better-auth emits host-only
 * cookies the tests can thread back via the `cookie` header, and so the default
 * `Origin` header below counts as a trusted origin: better-auth rejects
 * state-changing cookie requests that carry no `Origin` (`MISSING_OR_NULL_ORIGIN`,
 * its CSRF guard), exactly as a browser would send. The CLI is exempt in
 * production because it authenticates with a Bearer API key, not session cookies.
 */
const BASE = "http://localhost";

const dispatch = async (url: string, init?: RequestInit): Promise<Response> => {
  const ctx = createExecutionContext();
  const headers = { origin: BASE, ...(init?.headers as Record<string, string> | undefined) };
  const response = await worker.fetch(new Request(url, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

const parseCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");

const jsonRequest = (
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) =>
  dispatch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export function setupE2EWorker(_persistDir?: string) {
  return {
    getBaseUrl: () => BASE,
    getPersistDir: () => "",
    parseCookies,
    get: (path: string, headers?: Record<string, string>) =>
      dispatch(`${BASE}${path}`, headers ? { headers } : {}),
    post: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest("POST", path, body, headers),
    postRaw: (path: string, body: BodyInit, headers?: Record<string, string>) =>
      dispatch(`${BASE}${path}`, { method: "POST", ...(headers ? { headers } : {}), body }),
    patch: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest("PATCH", path, body, headers),
    put: (path: string, body: unknown, headers?: Record<string, string>) =>
      jsonRequest("PUT", path, body, headers),
    del: (path: string, headers?: Record<string, string>) =>
      dispatch(`${BASE}${path}`, { method: "DELETE", ...(headers ? { headers } : {}) }),
    postNoBody: (path: string, headers?: Record<string, string>) =>
      dispatch(`${BASE}${path}`, { method: "POST", ...(headers ? { headers } : {}) }),
    putAbsolute: (url: string, body: BodyInit, headers?: Record<string, string>) =>
      fetch(url, { method: "PUT", ...(headers ? { headers } : {}), body }),
  };
}

/**
 * Local-R2 substitute for the presigned PUT path. Writes asset bytes straight
 * into the `ASSETS_BUCKET` miniflare binding with the same `sha256` checksum +
 * `contentType` that a real direct upload would land — exactly what
 * `handleFinalize` reads back via `headObject` (`checksums.sha256`, `size`,
 * `httpMetadata.contentType`). This lets the publish/manifest flows run fully
 * local on `e2e-pool`; the genuine presigned-PUT + R2 checksum-enforcement path
 * stays on `e2e-pool-r2` (real R2) in `direct-upload-flow.test.ts`.
 *
 * `hash` is the asset's base64url SHA-256 (its id); the R2 key mirrors
 * `assetR2Key` in `src/handlers/assets.ts` (`assets/<hash>`).
 */
export async function seedAssetObject(params: {
  readonly hash: string;
  readonly content: string | Uint8Array;
  readonly contentType: string;
}): Promise<void> {
  const bytes =
    typeof params.content === "string" ? new TextEncoder().encode(params.content) : params.content;
  await env.ASSETS_BUCKET.put(`assets/${params.hash}`, bytes, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    httpMetadata: { contentType: params.contentType },
  });
}
