import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams, Platform } from "./common";

export class Update extends Schema.Class<Update>("Update")({
  id: Id,
  branchId: Id,
  runtimeVersion: Schema.String,
  platform: Platform,
  message: Schema.String,
  metadataJson: Schema.String,
  extraJson: Schema.NullOr(Schema.String),
  groupId: Schema.String,
  rolloutPercentage: Schema.Number,
  isRollback: Schema.Boolean,
  signature: Schema.NullOr(Schema.String),
  certificateChain: Schema.NullOr(Schema.String),
  manifestBody: Schema.NullOr(Schema.String),
  directiveBody: Schema.NullOr(Schema.String),
  fingerprintHash: Schema.NullOr(Schema.String),
  totalAssetSize: Schema.Number,
  createdAt: DateTimeString,
}) {}

export const UpdateSortColumn = Schema.Literal(
  "createdAt",
  "runtimeVersion",
  "platform",
  "rolloutPercentage",
);

/**
 * Sort param: column name optionally prefixed with `-` for descending.
 * Example: `runtimeVersion` (asc), `-createdAt` (desc).
 */
export const UpdateSort = Schema.Union(
  UpdateSortColumn,
  Schema.TemplateLiteral("-", UpdateSortColumn),
);

export const ListUpdatesParams = Schema.Struct({
  projectId: Id,
  branchId: Schema.optional(Id),
  platform: Schema.optional(Platform),
  runtimeVersion: Schema.optional(Schema.String),
  ...PaginationParams.fields,
  sort: Schema.optional(UpdateSort),
});

export const AssetRef = Schema.Struct({
  hash: Schema.String,
  key: Schema.String,
  isLaunch: Schema.Boolean,
  contentChecksum: Schema.optional(Schema.String),
});

export const UpdateAssetEntry = Schema.Struct({
  hash: Schema.String,
  key: Schema.String,
  isLaunch: Schema.Boolean,
  contentChecksum: Schema.NullOr(Schema.String),
});

export const CreateUpdateBody = Schema.Struct({
  branch: Schema.String.pipe(Schema.minLength(1)),
  slug: Schema.String.pipe(Schema.minLength(1)),
  runtimeVersion: Schema.String.pipe(Schema.minLength(1)),
  platform: Platform,
  message: Schema.String,
  groupId: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  extra: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  assets: Schema.Array(AssetRef),
  manifestBody: Schema.optional(Schema.String),
  directiveBody: Schema.optional(Schema.String),
  isRollback: Schema.optional(Schema.Boolean),
  signature: Schema.optional(Schema.String),
  certificateChain: Schema.optional(Schema.String),
  rolloutPercentage: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 100))),
  fingerprintHash: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export const RepublishBody = Schema.Struct({
  sourceUpdateId: Schema.optional(Id),
  sourceGroupId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  destinationBranchId: Schema.optional(Id),
  destinationChannel: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  message: Schema.optional(Schema.String),
  signedUpdates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        sourceUpdateId: Id,
        manifestBody: Schema.String.pipe(Schema.minLength(1)),
        signature: Schema.String.pipe(Schema.minLength(1)),
        certificateChain: Schema.String.pipe(Schema.minLength(1)),
      }),
    ),
  ),
});

export const RepublishResult = Schema.Struct({
  updates: Schema.Array(Update),
});

export const DeleteUpdateResult = Schema.Struct({
  deleted: Schema.Number,
});
