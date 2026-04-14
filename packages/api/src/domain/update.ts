import { Schema } from "effect";

import { DateTimeString, Id, Platform } from "./common";

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
  createdAt: DateTimeString,
}) {}

export const AssetRef = Schema.Struct({
  hash: Schema.String,
  key: Schema.String,
  isLaunch: Schema.Boolean,
});

export const CreateUpdateBody = Schema.Struct({
  branch: Schema.String.pipe(Schema.minLength(1)),
  project: Schema.String.pipe(Schema.minLength(1)),
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

export const UpdateRolloutBody = Schema.Struct({
  percentage: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
});
