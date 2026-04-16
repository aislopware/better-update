import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

const UploadHeaders = Schema.Record({ key: Schema.String, value: Schema.String });

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
