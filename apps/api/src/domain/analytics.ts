import { Schema } from "effect";

import { Id } from "./common";

export const AnalyticsParams = Schema.Struct({
  projectId: Id,
});

export const AdoptionEntry = Schema.Struct({
  updateId: Schema.String,
  groupId: Schema.String,
  adoptionRate: Schema.Number,
  deviceCount: Schema.Number,
});

export const AdoptionResult = Schema.Struct({
  entries: Schema.Array(AdoptionEntry),
});

export const UpdateAnalyticsEntry = Schema.Struct({
  updateId: Schema.String,
  downloads: Schema.Number,
  applies: Schema.Number,
  errors: Schema.Number,
});

export const UpdateAnalyticsResult = Schema.Struct({
  entries: Schema.Array(UpdateAnalyticsEntry),
});

export const ChannelAnalyticsEntry = Schema.Struct({
  channelId: Schema.String,
  channelName: Schema.String,
  activeDevices: Schema.Number,
});

export const ChannelAnalyticsResult = Schema.Struct({
  entries: Schema.Array(ChannelAnalyticsEntry),
});

export const PlatformAnalyticsEntry = Schema.Struct({
  platform: Schema.String,
  deviceCount: Schema.Number,
  percentage: Schema.Number,
});

export const PlatformAnalyticsResult = Schema.Struct({
  entries: Schema.Array(PlatformAnalyticsEntry),
});
