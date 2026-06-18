import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

/**
 * Regression guard for the D1 100-bound-parameter ceiling on `/api/assets/upload`.
 * A first publish registers EVERY asset as new, so the `findByHashes` IN (...)
 * list and the `insertBatch` statement count both scale with the request. Before
 * chunking, a request with >100 assets blew D1's per-statement parameter cap on
 * real D1 and surfaced as an opaque 500 ("Decode error" client-side). This
 * exercises a >100-asset batch and asserts every asset round-trips, dedup works
 * across chunk boundaries, and nothing 500s.
 *
 * Local D1 (miniflare) does not enforce the 100-param platform cap, so this also
 * functions as a correctness guard for the chunk/concat/dedup logic itself.
 */
const { parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-asset-bulk-register");

const ASSET_COUNT = 250; // comfortably past the 100-param ceiling and >1 chunk

const assetHash = (index: number): string =>
  createHash("sha256").update(`bulk-asset-${index}`).digest("base64url");

describe("Bulk asset registration (D1 param ceiling)", () => {
  let cookies: string;
  let projectId: string;

  it("bootstraps a user, org, and project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Bulk Asset User",
      email: "bulk-asset-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);
    expect(cookies).toBeTruthy();

    const org = await post(
      "/api/auth/organization/create",
      { name: "Bulk Asset Org", slug: "bulk-asset-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    const organizationId = (await org.json()).id;
    cookies = parseCookies(org) || cookies;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(active.status).toBe(200);
    cookies = parseCookies(active) || cookies;

    const project = await post(
      "/api/projects",
      { name: "Bulk Asset Project", slug: "bulk-asset" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    projectId = (await project.json()).id as string;
  });

  it("registers a >100-asset batch in one request without hitting the D1 param ceiling", async () => {
    const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
      hash: assetHash(index),
      contentType: "application/javascript",
      fileExt: "js",
    }));

    const response = await post("/api/assets/upload", { projectId, assets }, { cookie: cookies });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toHaveLength(ASSET_COUNT);
    expect(body.deduplicated).toEqual([]);
    // Every requested hash gets exactly one presigned slot back, across chunks.
    expect(new Set(body.uploaded.map((entry: { hash: string }) => entry.hash))).toEqual(
      new Set(assets.map((asset) => asset.hash)),
    );
  });

  it("detects a stored-metadata conflict on a hash beyond the first chunk", async () => {
    // Re-register all stored hashes, but flip the contentType of the LAST one —
    // which lands in a later chunk. `assertStoredMetadataMatches` only catches it
    // if `findByHashes` scanned every chunk, so a regression that returned only
    // the first chunk's rows would silently 201 here instead of 400.
    const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
      hash: assetHash(index),
      contentType: index === ASSET_COUNT - 1 ? "image/png" : ("application/javascript" as string),
      fileExt: index === ASSET_COUNT - 1 ? "png" : "js",
    }));

    const response = await post("/api/assets/upload", { projectId, assets }, { cookie: cookies });

    expect(response.status).toBe(400);
  });
});
