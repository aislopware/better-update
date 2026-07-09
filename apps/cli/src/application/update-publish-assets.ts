import { fromHex, toBase64Url } from "@better-update/encoding";
import { Effect } from "effect";
import { uniqBy } from "es-toolkit";

import type { FileSystem } from "@effect/platform";

import { readExpoExportAssets } from "../lib/expo-export";
import { sha256File, sha256Namespaced } from "../lib/sha256";

import type { Platform } from "../lib/build-profile";
import type { BuildFailedError, UpdatePublishError } from "../lib/exit-codes";

export interface PreparedAsset {
  readonly path: string;
  readonly key: string;
  readonly hash: string;
  readonly contentChecksum: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

export const dedupeAssetsByHash = (assets: readonly PreparedAsset[]): readonly PreparedAsset[] =>
  uniqBy(assets, (asset) => asset.hash);

// The create body is keyed server-side by `(update_id, asset_key)`. Expo names
// exported assets by content hash, so a metadata entry repeated across the export
// produces the same basename `key` twice; sending both would trip that primary
// key and fail the publish. Dedupe by key (not hash) so distinct keys sharing one
// content-addressed hash are preserved.
export const dedupeAssetsByKey = (assets: readonly PreparedAsset[]): readonly PreparedAsset[] =>
  uniqBy(assets, (asset) => asset.key);

export const preparePlatformAssets = ({
  exportDir,
  platform,
}: {
  readonly exportDir: string;
  readonly platform: Platform;
}): Effect.Effect<
  readonly PreparedAsset[],
  UpdatePublishError | BuildFailedError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const exportedAssets = yield* readExpoExportAssets({ exportDir, platform });
    return yield* Effect.forEach(
      exportedAssets,
      (asset) =>
        sha256File(asset.path).pipe(
          Effect.map(
            ({ sha256: contentSha256Hex, byteSize }): PreparedAsset => ({
              path: asset.path,
              key: asset.key,
              fileExt: asset.fileExt,
              contentType: asset.contentType,
              isLaunch: asset.isLaunch,
              hash: sha256Namespaced(asset.contentType, contentSha256Hex),
              contentChecksum: toBase64Url(fromHex(contentSha256Hex)),
              byteSize,
            }),
          ),
        ),
      { concurrency: 4 },
    );
  });
