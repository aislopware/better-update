import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import {
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  PlatformParams,
  PlatformResult,
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
  .annotateContext(
    OpenApi.annotations({
      title: "Analytics",
      description: "Deployment analytics endpoints",
    }),
  ) {}
