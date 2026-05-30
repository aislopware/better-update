import { Schema } from "effect";

import { DateTimeString, Id, Platform, UploadHeaders } from "./common";

export class Asset extends Schema.Class<Asset>("Asset")({
  hash: Schema.String,
  contentType: Schema.String,
  fileExt: Schema.String,
  byteSize: Schema.Number,
  r2Key: Schema.String,
  createdAt: DateTimeString,
}) {}

export const AssetUploadBody = Schema.Struct({
  projectId: Id,
  assets: Schema.Array(
    Schema.Struct({
      hash: Schema.String,
      contentType: Schema.String,
      fileExt: Schema.String,
      contentChecksum: Schema.optional(Schema.String),
    }),
  ),
});

export const AssetUploadResult = Schema.Struct({
  uploaded: Schema.Array(
    Schema.Struct({
      hash: Schema.String,
      uploadMode: Schema.Literal("single"),
      uploadUrl: Schema.String,
      uploadExpiresAt: DateTimeString,
      uploadHeaders: UploadHeaders,
    }),
  ),
  deduplicated: Schema.Array(Schema.String),
});

/**
 * Request a presigned PUT for a precomputed bsdiff patch. The server builds the
 * R2 key from this tuple (never trusting a client-sent key) as
 * `patches/{projectId}/{runtimeVersion}/{platform}/{from}__{to}.bsdiff`.
 */
export const PatchUploadBody = Schema.Struct({
  projectId: Id,
  runtimeVersion: Schema.String.pipe(Schema.minLength(1)),
  platform: Platform,
  fromUpdateId: Id,
  toUpdateId: Id,
});

export const PatchUploadResult = Schema.Struct({
  key: Schema.String,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});
