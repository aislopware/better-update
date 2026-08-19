import { Schema } from "effect";

import { DateTimeString, Id, Platform } from "./common";

// Per-runtime channel status — varies per (platform, runtimeVersion).
export const BuildCompatibilityChannel = Schema.Struct({
  channelId: Id,
  updateCount: Schema.Number,
  latestUpdateId: Schema.NullOr(Id),
  latestUpdateMessage: Schema.NullOr(Schema.String),
  latestUpdateCreatedAt: Schema.NullOr(DateTimeString),
}).annotate({ identifier: "BuildCompatibilityChannel" });
export type BuildCompatibilityChannel = typeof BuildCompatibilityChannel.Type;

// Channel-level metadata that does not depend on a specific build's runtime.
export const CompatibilityChannelInfo = Schema.Struct({
  channelId: Id,
  channelName: Schema.String,
  isPaused: Schema.Boolean,
  rolloutActive: Schema.Boolean,
}).annotate({ identifier: "CompatibilityChannelInfo" });
export type CompatibilityChannelInfo = typeof CompatibilityChannelInfo.Type;

export const MissingRuntimeVersionBuild = Schema.Struct({
  channelId: Id,
  channelName: Schema.String,
  platform: Platform,
  runtimeVersion: Schema.String,
  updateCount: Schema.Number,
  latestUpdateId: Id,
  latestUpdateMessage: Schema.String,
  latestUpdateCreatedAt: DateTimeString,
  rolloutActive: Schema.Boolean,
}).annotate({ identifier: "MissingRuntimeVersionBuild" });
export type MissingRuntimeVersionBuild = typeof MissingRuntimeVersionBuild.Type;

export const BuildCompatibilityMatrixResult = Schema.Struct({
  channels: Schema.Array(CompatibilityChannelInfo),
  channelStatusByKey: Schema.Record(Schema.String, Schema.Array(BuildCompatibilityChannel)),
  missingRuntimeVersions: Schema.Array(MissingRuntimeVersionBuild),
});
