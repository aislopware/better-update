import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { r2Checksums, r2ListCursor } from "../cloudflare/r2-accessors";
import { toDbNull } from "../lib/nullable";
import { r2Operation, toChecksumSha256Base64 } from "../lib/r2-helpers";

import type { StoredBlob } from "../cloudflare/asset-storage";

// Re-export so the application/ layer can reference the blob shape returned by
// this port without importing cloudflare/ (which the hexagonal boundary forbids).
export type { StoredBlob } from "../cloudflare/asset-storage";

// -- Port ------------------------------------------------------------------

// Bundle-serving R2 reads for the Expo OTA bundle route (A-IM negotiation).
//
// Keeps bundle/patch serving concerns isolated from the asset-management port
// (AssetStorage handles upload-url/head/put/delete; this repo is read-only).
// Both reads hit env.ASSETS_BUCKET:
//   - getPatch: precomputed bsdiff patch at a deterministic key built by
//     protocol/patchR2Key (patches/{project}/{rv}/{platform}/{from}__{to}.bsdiff).
//   - getFullBundle: the full launch-bundle object at the existing assets/{hash}
//     key, served as the backward-compatible fallback.
/** One R2 object surfaced to the OTA reaper's patch sweep. */
export interface BundleObjectListing {
  readonly key: string;
  readonly uploaded: Date;
}

export interface BundleRepository {
  /** R2 GET a precomputed bsdiff patch by its full object key. null => miss. */
  readonly getPatch: (params: { readonly key: string }) => Effect.Effect<StoredBlob | null>;

  /**
   * R2 GET the full launch bundle by its content hash. Reuses the existing
   * `assets/{hash}` object key. null => miss.
   */
  readonly getFullBundle: (params: { readonly hash: string }) => Effect.Effect<StoredBlob | null>;

  /**
   * Enumerate ASSETS_BUCKET objects under `prefix`, paginated by cursor. The OTA
   * reaper uses this to walk `patches/{projectId}/` (patches carry no D1 row, so
   * listing is the only way to discover orphaned/stale patch blobs).
   */
  readonly listObjects: (params: {
    readonly prefix: string;
    readonly cursor?: string;
  }) => Effect.Effect<{
    readonly objects: readonly BundleObjectListing[];
    readonly truncated: boolean;
    readonly cursor: string | undefined;
  }>;

  /** Delete ASSETS_BUCKET objects by key (no-op on empty input). */
  readonly deleteObjects: (params: { readonly keys: readonly string[] }) => Effect.Effect<void>;
}

export class BundleRepo extends Context.Tag("api/BundleRepo")<BundleRepo, BundleRepository>() {}

// -- R2 Adapter ------------------------------------------------------------

// The full bundle reuses the existing asset object layout: `assets/{hash}`.
const fullBundleKey = (hash: string): string => `assets/${hash}`;

const toStoredBlob = (object: R2ObjectBody): StoredBlob => ({
  body: object.body,
  size: object.size,
  etag: object.httpEtag,
  contentType: toDbNull(object.httpMetadata?.contentType),
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(r2Checksums(object)),
});

export const BundleRepoLive = Layer.succeed(BundleRepo, {
  getPatch: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* r2Operation(async () => env.ASSETS_BUCKET.get(params.key));
      return object ? toStoredBlob(object) : null;
    }),

  getFullBundle: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* r2Operation(async () =>
        env.ASSETS_BUCKET.get(fullBundleKey(params.hash)),
      );
      return object ? toStoredBlob(object) : null;
    }),

  listObjects: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const listed = yield* r2Operation(async () =>
        env.ASSETS_BUCKET.list(
          params.cursor
            ? { prefix: params.prefix, cursor: params.cursor }
            : { prefix: params.prefix },
        ),
      );

      return {
        objects: listed.objects.map((object) => ({
          key: object.key,
          uploaded: object.uploaded,
        })),
        truncated: listed.truncated,
        cursor: r2ListCursor(listed),
      };
    }),

  deleteObjects: (params) =>
    Effect.gen(function* () {
      if (params.keys.length === 0) {
        return;
      }
      const env = yield* cloudflareEnv;
      yield* r2Operation(async () => env.ASSETS_BUCKET.delete([...params.keys]));
    }),
});
