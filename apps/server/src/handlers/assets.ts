import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertPermission } from "../auth/permissions";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { AssetRepo } from "../repositories/assets";

export const AssetsGroupLive = HttpApiBuilder.group(ManagementApi, "assets", (handlers) =>
  handlers.handle("upload", ({ payload }) =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        yield* assertPermission("update", "create");

        const repo = yield* AssetRepo;

        // Check which assets already exist (dedup by hash)
        const hashes = payload.assets.map((asset) => asset.hash);
        const existingAssets = yield* repo.findByHashes({ hashes });
        const existingHashes = new Set(existingAssets.map((asset) => asset.hash));

        const newAssets = payload.assets.filter((asset) => !existingHashes.has(asset.hash));
        const deduplicatedHashes = payload.assets
          .filter((asset) => existingHashes.has(asset.hash))
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

        return {
          uploaded: newAssets.map((asset) => asset.hash),
          deduplicated: deduplicatedHashes,
        };
      }),
    ),
  ),
);
