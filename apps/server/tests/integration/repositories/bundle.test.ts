import { env } from "cloudflare:test";
import { Effect } from "effect";

import { BundleRepo, BundleRepoLive } from "../../../src/repositories/bundle";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, BundleRepo>) =>
  runWithLayerAndEnv(effect, BundleRepoLive, env);

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await env.ASSETS_BUCKET.put(
    "patches/bundle-test/1.0.0/ios/a__b.bsdiff",
    new Uint8Array([1, 2, 3]),
    { httpMetadata: { contentType: "application/octet-stream" } },
  );
  await env.ASSETS_BUCKET.put("assets/bundle-test-hash", new Uint8Array([4, 5, 6]), {
    httpMetadata: { contentType: "application/javascript" },
  });
  await env.ASSETS_BUCKET.put("patches/bundle-list/1.0.0/ios/a__b.bsdiff", new Uint8Array([7]));
  await env.ASSETS_BUCKET.put("patches/bundle-list/1.0.0/ios/c__d.bsdiff", new Uint8Array([8]));
  await env.ASSETS_BUCKET.put("patches/bundle-del/x.bsdiff", new Uint8Array([9]));
});

// ── Tests ─────────────────────────────────────────────────────────

describe("BundleRepo — R2 integration", () => {
  it("getPatch returns a StoredBlob for a matching key", async () => {
    const blob = await run(
      Effect.gen(function* () {
        const repo = yield* BundleRepo;
        return yield* repo.getPatch({ key: "patches/bundle-test/1.0.0/ios/a__b.bsdiff" });
      }),
    );

    expect(blob).not.toBeNull();
    expect(blob?.size).toBe(3);
    expect(blob?.contentType).toBe("application/octet-stream");
  });

  it("getPatch returns null on a cache miss", async () => {
    const blob = await run(
      Effect.gen(function* () {
        const repo = yield* BundleRepo;
        return yield* repo.getPatch({ key: "patches/bundle-test/1.0.0/ios/missing.bsdiff" });
      }),
    );

    expect(blob).toBeNull();
  });

  it("getFullBundle reads from the assets/{hash} key and returns a StoredBlob", async () => {
    const blob = await run(
      Effect.gen(function* () {
        const repo = yield* BundleRepo;
        return yield* repo.getFullBundle({ hash: "bundle-test-hash" });
      }),
    );

    expect(blob).not.toBeNull();
    expect(blob?.size).toBe(3);
    expect(blob?.contentType).toBe("application/javascript");
  });

  it("listObjects returns all objects under the given prefix", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* BundleRepo;
        return yield* repo.listObjects({ prefix: "patches/bundle-list/" });
      }),
    );

    expect(result.objects).toHaveLength(2);
    expect(result.objects.map((o) => o.key).sort()).toEqual([
      "patches/bundle-list/1.0.0/ios/a__b.bsdiff",
      "patches/bundle-list/1.0.0/ios/c__d.bsdiff",
    ]);
  });

  it("deleteObjects removes the given keys from R2", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* BundleRepo;
        yield* repo.deleteObjects({ keys: ["patches/bundle-del/x.bsdiff"] });
      }),
    );

    const object = await env.ASSETS_BUCKET.get("patches/bundle-del/x.bsdiff");
    expect(object).toBeNull();
  });
});
