import { PatchBaseCandidate } from "@better-update/api";

import type { PatchBaseRow } from "../repositories/update-patch-base-sql";

export const toApiPatchBaseCandidate = (row: PatchBaseRow) =>
  new PatchBaseCandidate({
    updateId: row.updateId,
    launchAssetHash: row.launchAssetHash,
    runtimeVersion: row.runtimeVersion,
    platform: row.platform,
    isEmbedded: row.isEmbedded,
    createdAt: row.createdAt,
  });

export const toApiPatchUploadResult = (params: {
  readonly key: string;
  readonly uploadUrl: string;
  readonly uploadExpiresAt: string;
  readonly uploadHeaders: Readonly<Record<string, string>>;
}) => ({
  key: params.key,
  uploadUrl: params.uploadUrl,
  uploadExpiresAt: params.uploadExpiresAt,
  uploadHeaders: params.uploadHeaders,
});
