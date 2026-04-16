import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { AssetStorage } from "../cloudflare/asset-storage";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { fromBase64, fromBase64Url, toBase64, toBase64Url } from "../lib/base64";
import { AssetRepo } from "../repositories/assets";

const UPLOAD_EXPIRY_SECONDS = 7200;

const fail = (message: string) => new BadRequest({ message });

const assetR2Key = (params: { readonly hash: string; readonly fileExt: string }) =>
  `assets/${params.hash}.${params.fileExt}`;

const sha256Base64UrlToBase64 = (hash: string): string => toBase64(fromBase64Url(hash));

const sha256Base64ToBase64Url = (hash: string): string => toBase64Url(fromBase64(hash));

const assertConsistentRequestedAssets = (params: {
  readonly assets: readonly {
    readonly hash: string;
    readonly contentType: string;
    readonly fileExt: string;
    readonly contentChecksum?: string | undefined;
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
    readonly contentChecksum?: string | undefined;
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

const toApiAsset = (asset: {
  readonly hash: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly byteSize: number;
  readonly r2Key: string;
  readonly createdAt: string;
}) => ({
  hash: asset.hash,
  contentType: asset.contentType,
  fileExt: asset.fileExt,
  byteSize: asset.byteSize,
  r2Key: asset.r2Key,
  createdAt: asset.createdAt,
});

const handleUpload = ({
  payload,
}: {
  readonly payload: {
    readonly projectId: string;
    readonly assets: readonly {
      readonly hash: string;
      readonly contentType: string;
      readonly fileExt: string;
      readonly contentChecksum?: string | undefined;
    }[];
  };
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("update", "create");
      yield* assertProjectOwnership(payload.projectId);
      yield* assertConsistentRequestedAssets({ assets: payload.assets });

      const repo = yield* AssetRepo;
      const storage = yield* AssetStorage;

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

      if (newAssets.length > 0) {
        yield* repo.insertBatch({
          assets: newAssets.map((asset) => ({
            hash: asset.hash,
            contentType: asset.contentType,
            fileExt: asset.fileExt,
            byteSize: 0,
            r2Key: assetR2Key(asset),
            contentChecksum: asset.contentChecksum ?? asset.hash,
          })),
        });
      }

      const uploaded = yield* Effect.forEach(
        uploadableAssets,
        (asset) =>
          Effect.gen(function* () {
            // Use contentChecksum (raw file hash) for R2 verification.
            // Fall back to hash for backward compat with old CLIs (where hash IS the content hash).
            const rawChecksum = asset.contentChecksum ?? asset.hash;
            const checksumSha256Base64 = sha256Base64UrlToBase64(rawChecksum);
            const uploadUrl = yield* storage.createUploadUrl({
              key: assetR2Key(asset),
              contentType: asset.contentType,
              checksumSha256Base64,
              expiresIn: UPLOAD_EXPIRY_SECONDS,
            });
            const uploadExpiresAt = new Date(
              Date.now() + UPLOAD_EXPIRY_SECONDS * 1000,
            ).toISOString();

            return {
              hash: asset.hash,
              uploadMode: "single" as const,
              uploadUrl,
              uploadExpiresAt,
              uploadHeaders: createDirectUploadHeaders({
                checksumSha256Base64,
                contentType: asset.contentType,
              }),
            };
          }),
        { concurrency: "unbounded" },
      );

      return {
        uploaded,
        deduplicated: deduplicatedRequestedHashes.filter(
          (hash, index, values) => values.indexOf(hash) === index,
        ),
      };
    }),
  );

const handleFinalize = ({ path }: { readonly path: { readonly hash: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("update", "create");

      const repo = yield* AssetRepo;
      const storage = yield* AssetStorage;
      const asset = yield* repo.findByHash({ hash: path.hash });

      if (!asset) {
        return yield* Effect.fail(new NotFound({ message: "Asset not registered" }));
      }

      if (asset.byteSize > 0) {
        return toApiAsset(asset);
      }

      const stored = yield* storage.headObject({ key: asset.r2Key });
      if (!stored) {
        return yield* Effect.fail(new NotFound({ message: "Asset not uploaded to R2" }));
      }

      if (stored.checksumSha256Base64 === null) {
        return yield* Effect.fail(
          new BadRequest({ message: `Asset ${asset.hash} is missing an R2 SHA-256 checksum` }),
        );
      }

      // Compare R2's stored checksum against contentChecksum (raw file hash).
      // For old assets (pre-namespaced), contentChecksum equals hash — still correct.
      const expectedChecksum = asset.contentChecksum || asset.hash;
      if (sha256Base64ToBase64Url(stored.checksumSha256Base64) !== expectedChecksum) {
        return yield* Effect.fail(
          new BadRequest({ message: `Asset ${asset.hash} checksum does not match uploaded bytes` }),
        );
      }

      if (stored.contentType !== null && stored.contentType !== asset.contentType) {
        return yield* Effect.fail(
          new BadRequest({
            message: `Asset ${asset.hash} content type mismatch: expected ${asset.contentType}, got ${stored.contentType}`,
          }),
        );
      }

      yield* repo.updateByteSize({ hash: asset.hash, byteSize: stored.size });

      return toApiAsset({
        ...asset,
        byteSize: stored.size,
      });
    }),
  );

export const AssetsGroupLive = HttpApiBuilder.group(ManagementApi, "assets", (handlers) =>
  handlers.handle("upload", handleUpload).handle("finalize", handleFinalize),
);
