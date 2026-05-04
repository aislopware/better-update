import { Schema } from "effect";

import { DateTimeString, Id, Platform } from "./common";

// Per-runtime channel status — varies per (platform, runtimeVersion).
export class BuildCompatibilityChannel extends Schema.Class<BuildCompatibilityChannel>(
  "BuildCompatibilityChannel",
)({
  channelId: Id,
  updateCount: Schema.Number,
  latestUpdateId: Schema.NullOr(Id),
  latestUpdateMessage: Schema.NullOr(Schema.String),
  latestUpdateCreatedAt: Schema.NullOr(DateTimeString),
}) {}

// Channel-level metadata that does not depend on a specific build's runtime.
export class CompatibilityChannelInfo extends Schema.Class<CompatibilityChannelInfo>(
  "CompatibilityChannelInfo",
)({
  channelId: Id,
  channelName: Schema.String,
  isPaused: Schema.Boolean,
  rolloutActive: Schema.Boolean,
}) {}

export class MissingRuntimeVersionBuild extends Schema.Class<MissingRuntimeVersionBuild>(
  "MissingRuntimeVersionBuild",
)({
  channelId: Id,
  channelName: Schema.String,
  platform: Platform,
  runtimeVersion: Schema.String,
  updateCount: Schema.Number,
  latestUpdateId: Id,
  latestUpdateMessage: Schema.String,
  latestUpdateCreatedAt: DateTimeString,
  rolloutActive: Schema.Boolean,
}) {}

export const BuildCompatibilityMatrixResult = Schema.Struct({
  channels: Schema.Array(CompatibilityChannelInfo),
  channelStatusByKey: Schema.Record({
    key: Schema.String,
    value: Schema.Array(BuildCompatibilityChannel),
  }),
  missingRuntimeVersions: Schema.Array(MissingRuntimeVersionBuild),
});
