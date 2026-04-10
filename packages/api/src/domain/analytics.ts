import { Schema } from "effect";

import { Id } from "./common";

// -- Shared --

export const Period = Schema.optional(Schema.Literal("1d", "7d", "30d", "90d"));

// -- Adoption --

export const AdoptionParams = Schema.Struct({
  projectId: Id,
  period: Period,
});

const AdoptionEntry = Schema.Struct({
  updateId: Schema.String,
  devices: Schema.Number,
  firstSeen: Schema.String,
  lastSeen: Schema.String,
});

export const AdoptionResult = Schema.Struct({
  updates: Schema.Array(AdoptionEntry),
});

// -- Update Analytics --

export const UpdateAnalyticsParams = Schema.Struct({
  projectId: Id,
  updateId: Schema.String,
  period: Period,
});

const ResponseTypeBreakdown = Schema.Struct({
  manifest: Schema.Number,
  directive: Schema.Number,
  no_update: Schema.Number,
});

const TimeSeriesEntry = Schema.Struct({
  timestamp: Schema.String,
  requests: Schema.Number,
});

export const UpdateAnalyticsResult = Schema.Struct({
  updateId: Schema.String,
  totalRequests: Schema.Number,
  uniqueDevices: Schema.Number,
  byResponseType: ResponseTypeBreakdown,
  timeSeries: Schema.Array(TimeSeriesEntry),
});

// -- Channel Analytics --

export const ChannelAnalyticsParams = Schema.Struct({
  projectId: Id,
  channel: Schema.String,
  period: Period,
});

export const ChannelAnalyticsResult = Schema.Struct({
  channel: Schema.String,
  totalRequests: Schema.Number,
  uniqueDevices: Schema.Number,
  responseTypeDistribution: ResponseTypeBreakdown,
});

// -- Platform Analytics --

export const PlatformParams = Schema.Struct({
  projectId: Id,
  period: Period,
});

const PlatformEntry = Schema.Struct({
  platform: Schema.String,
  requests: Schema.Number,
  devices: Schema.Number,
});

export const PlatformResult = Schema.Struct({
  platforms: Schema.Array(PlatformEntry),
});
