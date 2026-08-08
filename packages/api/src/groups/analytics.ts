import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ActivityParams,
  ActivityResult,
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  PlatformParams,
  PlatformResult,
  ProjectActivityParams,
  ProjectActivityResult,
  UpdateAnalyticsParams,
  UpdateAnalyticsResult,
} from "../domain/analytics";

export class AnalyticsGroup extends HttpApiGroup.make("analytics")
  .add(
    HttpApiEndpoint.get("adoption", "/api/analytics/adoption")
      .setUrlParams(AdoptionParams)
      .addSuccess(AdoptionResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Adoption analytics",
          description: "Adoption rate per update for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("updates", "/api/analytics/updates")
      .setUrlParams(UpdateAnalyticsParams)
      .addSuccess(UpdateAnalyticsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Update analytics",
          description: "Request metrics for a specific update",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("channels", "/api/analytics/channels")
      .setUrlParams(ChannelAnalyticsParams)
      .addSuccess(ChannelAnalyticsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Channel analytics",
          description: "Channel-level health metrics",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("platforms", "/api/analytics/platforms")
      .setUrlParams(PlatformParams)
      .addSuccess(PlatformResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Platform analytics",
          description: "Device count breakdown by platform",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("activity", "/api/analytics/activity")
      .setUrlParams(ActivityParams)
      .addSuccess(ActivityResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Shipping activity",
          description: "Updates and builds published per day, for an org or one project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("projectActivity", "/api/analytics/activity/by-project")
      .setUrlParams(ProjectActivityParams)
      .addSuccess(ProjectActivityResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Shipping activity by project",
          description: "The same daily series, one series per project",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Analytics",
      description: "Deployment analytics endpoints",
    }),
  ) {}
