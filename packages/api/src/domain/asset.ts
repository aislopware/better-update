import { Schema } from "effect";

import { DateTimeString } from "./common";

export class Asset extends Schema.Class<Asset>("Asset")({
  hash: Schema.String,
  contentType: Schema.String,
  fileExt: Schema.String,
  byteSize: Schema.Number,
  r2Key: Schema.String,
  createdAt: DateTimeString,
}) {}

export const AssetUploadBody = Schema.Struct({
  assets: Schema.Array(
    Schema.Struct({
      hash: Schema.String,
      contentType: Schema.String,
      fileExt: Schema.String,
    }),
  ),
});

export const AssetUploadResult = Schema.Struct({
  uploaded: Schema.Array(Schema.String),
  deduplicated: Schema.Array(Schema.String),
});
