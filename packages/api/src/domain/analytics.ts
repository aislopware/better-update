import { Schema } from "effect";

import { Id, csvList } from "./common";

// -- Shared --

export const PeriodLiteral = Schema.Literal("1d", "7d", "30d", "90d");
export const Period = Schema.optional(PeriodLiteral);

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

// -- Shipping activity --

/**
 * What was shipped, per day. Sourced from the updates and builds tables rather
 * than from device telemetry, so it reads the same on a project nobody has run
 * yet: publishing is an act the dashboard can always account for, while request
 * metrics only exist once installs start checking in.
 *
 * `projectId` narrows to one project; without it the series covers every
 * project the caller can see in their organization.
 */
export const ActivityParams = Schema.Struct({
  projectId: Schema.optional(Id),
  period: Period,
});

const ActivityEntry = Schema.Struct({
  /** Calendar day, `YYYY-MM-DD`, UTC. */
  date: Schema.String,
  updates: Schema.Number,
  builds: Schema.Number,
});

export const ActivityResult = Schema.Struct({
  /** Dense: every day in the period is present, zeros included. */
  series: Schema.Array(ActivityEntry),
  totalUpdates: Schema.Number,
  totalBuilds: Schema.Number,
});

// -- Shipping activity, split by project --

/**
 * The same daily series, one per project, so a list of projects can draw each
 * row's own shape instead of one organization-wide total above them all.
 *
 * `projectIds` narrows within what the caller can already see — it is a filter,
 * not a grant, and the org and visibility scoping the ungrouped endpoint applies
 * still applies here. Callers pass the page they are rendering, which is what
 * keeps the response bounded on an organization with hundreds of projects.
 */
export const ProjectActivityParams = Schema.Struct({
  projectIds: Schema.optional(csvList(Id)),
  period: Period,
});

const ProjectActivityEntry = Schema.Struct({
  projectId: Id,
  /** Dense over the period, exactly like the ungrouped series. */
  series: Schema.Array(ActivityEntry),
  totalUpdates: Schema.Number,
  totalBuilds: Schema.Number,
});

export const ProjectActivityResult = Schema.Struct({
  /** Only projects with something in the window; the rest are absent, not zero-filled. */
  projects: Schema.Array(ProjectActivityEntry),
});
