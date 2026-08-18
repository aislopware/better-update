import { Schema } from "effect";

import { Id, csvList } from "./common";

// -- Shared --

export const PeriodLiteral = Schema.Literal("1d", "7d", "30d", "90d");
export const Period = Schema.optional(PeriodLiteral);

/**
 * True when the server could not reach Workers Analytics Engine at all — the
 * numbers below are zeros because nothing was asked, not because nothing was
 * found. The endpoints deliberately still answer 200: a telemetry outage must
 * not take the dashboard down with it. Callers render a different message for
 * the two cases, which is the whole reason this is on the wire.
 *
 * The usual cause on a self-hosted instance is a missing `CLOUDFLARE_API_TOKEN`
 * worker secret, or a token without *Account Analytics Read*.
 */
const Unavailable = Schema.Boolean;

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
  unavailable: Unavailable,
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
  unavailable: Unavailable,
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
  unavailable: Unavailable,
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
  unavailable: Unavailable,
});

// -- Bundle delivery --

/**
 * What the bundle route served, as opposed to what the manifest route was
 * asked. A manifest check and a bundle download are separate requests: a device
 * already on the latest update checks and downloads nothing, and a device that
 * does download takes either a bsdiff patch or the full bundle. Only this
 * dataset knows which, and how many bytes it cost.
 */
export const DeliveryParams = Schema.Struct({
  projectId: Id,
  period: Period,
});

export const DeliveryResult = Schema.Struct({
  /** Requests that produced a body — `patchDownloads + fullDownloads`. */
  downloads: Schema.Number,
  patchDownloads: Schema.Number,
  fullDownloads: Schema.Number,
  /** Unknown update id, or a runtime version that did not match. */
  notFound: Schema.Number,
  bytesServed: Schema.Number,
  /** Requests whose client advertised `a-im: bsdiff` — the hit-rate denominator. */
  patchEligibleRequests: Schema.Number,
  unavailable: Unavailable,
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
