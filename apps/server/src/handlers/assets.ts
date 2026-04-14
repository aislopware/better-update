import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { BadRequest } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { createAssetUploadToken } from "../lib/asset-upload-token";
import { AssetRepo } from "../repositories/assets";

const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;

const fail = (message: string) => new BadRequest({ message });

const assertConsistentRequestedAssets = (params: {
  readonly assets: readonly {
    readonly hash: string;
    readonly contentType: string;
    readonly fileExt: string;
  }[];
}) => {
  const conflictingHash = params.assets.reduce<string | null>((current, asset, index, assets) => {
    if (current !== null) {
      return current;
    }

    const existing = assets.slice(0, index).find((candidate) => candidate.hash === asset.hash);
    if (!existing) {
      return null;
    }

    return existing.contentType !== asset.contentType || existing.fileExt !== asset.fileExt
      ? asset.hash
      : null;
  }, null);

  return conflictingHash === null
    ? Effect.void
    : Effect.fail(
        fail(`Asset ${conflictingHash} was provided multiple times with conflicting metadata`),
      );
};

const assertStoredMetadataMatches = (params: {
  readonly requestedAssets: readonly {
    readonly hash: string;
    readonly contentType: string;
    readonly fileExt: string;
  }[];
  readonly existingAssets: readonly {
    readonly hash: string;
    readonly contentType: string;
    readonly fileExt: string;
  }[];
}) =>
  Effect.gen(function* () {
    const existingByHash = new Map(params.existingAssets.map((asset) => [asset.hash, asset]));

    const mismatch = params.requestedAssets.find((asset) => {
      const existing = existingByHash.get(asset.hash);
      return (
        existing !== undefined &&
        (existing.contentType !== asset.contentType || existing.fileExt !== asset.fileExt)
      );
    });

    if (mismatch) {
      yield* fail(`Asset ${mismatch.hash} is already registered with different metadata`);
    }
  });

export const AssetsGroupLive = HttpApiBuilder.group(ManagementApi, "assets", (handlers) =>
  handlers.handle("upload", ({ payload }) =>
    toApiBadRequestReadEffect(
      Effect.gen(function* () {
        yield* assertPermission("update", "create");
        yield* assertProjectOwnership(payload.projectId);
        yield* assertConsistentRequestedAssets({ assets: payload.assets });

        const repo = yield* AssetRepo;
        const env = yield* cloudflareEnv;

        // Check which assets already exist (dedup by hash)
        const hashes = payload.assets.map((asset) => asset.hash);
        const existingAssets = yield* repo.findByHashes({ hashes });
        const existingHashes = new Set(existingAssets.map((asset) => asset.hash));
        yield* assertStoredMetadataMatches({
          requestedAssets: payload.assets,
          existingAssets,
        });

        const uploadableAssets = payload.assets.filter((asset) => {
          const existing = existingAssets.find((candidate) => candidate.hash === asset.hash);
          return existing === undefined || existing.byteSize === 0;
        });
        const newAssets = uploadableAssets.filter((asset) => !existingHashes.has(asset.hash));
        const uploadableHashes = new Set(uploadableAssets.map((asset) => asset.hash));
        const deduplicatedRequestedHashes = payload.assets
          .filter((asset) => !uploadableHashes.has(asset.hash))
          .map((asset) => asset.hash);

        // Register new assets in D1 (byteSize = 0 until blob uploaded)
        if (newAssets.length > 0) {
          yield* repo.insertBatch({
            assets: newAssets.map((asset) => ({
              hash: asset.hash,
              contentType: asset.contentType,
              fileExt: asset.fileExt,
              byteSize: 0,
              r2Key: `assets/${asset.hash}.${asset.fileExt}`,
            })),
          });
        }

        const uploaded = yield* Effect.forEach(
          uploadableAssets,
          (asset) =>
            Effect.tryPromise({
              try: async () =>
                createAssetUploadToken(
                  {
                    hash: asset.hash,
                    expiresAt: new Date(Date.now() + UPLOAD_TOKEN_TTL_MS).toISOString(),
                  },
                  env.BETTER_AUTH_SECRET,
                ),
              catch: (cause) =>
                new BadRequest({
                  message: `Failed to create upload token for asset ${asset.hash}: ${String(cause)}`,
                }),
            }).pipe(Effect.map((uploadToken) => ({ hash: asset.hash, uploadToken }))),
          { concurrency: "unbounded" },
        );

        return {
          uploaded,
          deduplicated: deduplicatedRequestedHashes.filter(
            (hash, index, values) => values.indexOf(hash) === index,
          ),
        };
      }),
    ),
  ),
);
