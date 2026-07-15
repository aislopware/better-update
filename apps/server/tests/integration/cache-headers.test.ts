import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

// Workers Cache (wrangler `cache.enabled`) stores any GET/HEAD response whose
// Cache-Control opts in, so cacheability is a per-route contract enforced at
// the worker boundary (src/index.ts withDefaultCacheControl + per-route
// headers). These tests pin that contract end-to-end through the real fetch
// handler: the only opt-ins are full OTA bundles and /api/config; everything
// else must say `no-store` (or its own explicit private/no-store) so a front
// cache can never store presigned redirects, plists, or management responses.
// The cache itself is not simulated by vitest-pool-workers — headers are the
// testable surface; hit/miss behavior is verified in prod via Cf-Cache-Status.

const BASE = "http://localhost";

const dispatch = async (path: string, init?: RequestInit): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

describe("worker boundary cache-control contract", () => {
  it("/api/config opts into shared caching with a bounded killswitch TTL", async () => {
    const response = await dispatch("/api/config");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("/api/health is never cacheable (monitoring must observe live state)", async () => {
    const response = await dispatch("/api/health");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("stamps no-store on management API responses that declare nothing", async () => {
    // Unauthenticated management route: whatever the status, the response must
    // not be storable by the front cache.
    const response = await dispatch("/api/projects");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("stamps no-store on auth responses", async () => {
    const response = await dispatch("/api/auth/get-session");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the manifest route's own private, max-age=0 untouched", async () => {
    const response = await dispatch("/manifest/nonexistent-project", {
      headers: {
        accept: "application/expo+json",
        "expo-platform": "ios",
        "expo-runtime-version": "1.0.0",
        "expo-protocol-version": "1",
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
  });

  it("bundle 404 is no-store (a cached miss would outlive publish replication)", async () => {
    const response = await dispatch(
      "/manifest/proj-x/bundle/00000000-0000-0000-0000-000000000000/deadbeef",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
