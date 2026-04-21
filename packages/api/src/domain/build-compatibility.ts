import { Schema } from "effect";

import { BuildWithArtifact } from "./build";
import { DateTimeString, Id, Platform } from "./common";

export class BuildCompatibilityChannel extends Schema.Class<BuildCompatibilityChannel>(
  "BuildCompatibilityChannel",
)({
  channelId: Id,
  channelName: Schema.String,
  updateCount: Schema.Number,
  latestUpdateId: Schema.NullOr(Id),
  latestUpdateMessage: Schema.NullOr(Schema.String),
  latestUpdateCreatedAt: Schema.NullOr(DateTimeString),
  isPaused: Schema.Boolean,
  rolloutActive: Schema.Boolean,
}) {}

export class BuildCompatibilityRow extends BuildWithArtifact.extend<BuildCompatibilityRow>(
  "BuildCompatibilityRow",
)({
  channels: Schema.Array(BuildCompatibilityChannel),
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
  rows: Schema.Array(BuildCompatibilityRow),
  missingRuntimeVersions: Schema.Array(MissingRuntimeVersionBuild),
});
