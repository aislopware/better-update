import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ActivityParams,
  ActivityResult,
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  DeliveryParams,
  DeliveryResult,
  PlatformParams,
  PlatformResult,
  ProjectActivityParams,
  ProjectActivityResult,
  UpdateAnalyticsParams,
  UpdateAnalyticsResult,
} from "../domain/analytics";

export const AnalyticsGroup = HttpApiGroup.make("analytics")
  .add(
    HttpApiEndpoint.get("adoption", "/api/analytics/adoption", {
      query: AdoptionParams,
      success: AdoptionResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Adoption analytics",
        description: "Adoption rate per update for a project",
      }),
    ),
    HttpApiEndpoint.get("updates", "/api/analytics/updates", {
      query: UpdateAnalyticsParams,
      success: UpdateAnalyticsResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update analytics",
        description: "Request metrics for a specific update",
      }),
    ),
    HttpApiEndpoint.get("channels", "/api/analytics/channels", {
      query: ChannelAnalyticsParams,
      success: ChannelAnalyticsResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Channel analytics",
        description: "Channel-level health metrics",
      }),
    ),
    HttpApiEndpoint.get("platforms", "/api/analytics/platforms", {
      query: PlatformParams,
      success: PlatformResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Platform analytics",
        description: "Device count breakdown by platform",
      }),
    ),
    HttpApiEndpoint.get("downloads", "/api/analytics/downloads", {
      query: DeliveryParams,
      success: DeliveryResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Bundle delivery analytics",
        description: "Bundle downloads: patch vs full, bytes served, patch hit-rate",
      }),
    ),
    HttpApiEndpoint.get("activity", "/api/analytics/activity", {
      query: ActivityParams,
      success: ActivityResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Shipping activity",
        description: "Updates and builds published per day, for an org or one project",
      }),
    ),
    HttpApiEndpoint.get("projectActivity", "/api/analytics/activity/by-project", {
      query: ProjectActivityParams,
      success: ProjectActivityResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Shipping activity by project",
        description: "The same daily series, one series per project",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Analytics",
      description: "Deployment analytics endpoints",
    }),
  );
