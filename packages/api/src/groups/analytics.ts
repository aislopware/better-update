import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import {
  AdoptionResult,
  AnalyticsParams,
  ChannelAnalyticsResult,
  PlatformAnalyticsResult,
  UpdateAnalyticsResult,
} from "../domain/analytics";

export class AnalyticsGroup extends HttpApiGroup.make("analytics")
  .add(
    HttpApiEndpoint.get("adoption", "/api/analytics/adoption")
      .setUrlParams(AnalyticsParams)
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
      .setUrlParams(AnalyticsParams)
      .addSuccess(UpdateAnalyticsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Update analytics",
          description: "Download and apply counts per update",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("channels", "/api/analytics/channels")
      .setUrlParams(AnalyticsParams)
      .addSuccess(ChannelAnalyticsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Channel analytics",
          description: "Active device count per channel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("platforms", "/api/analytics/platforms")
      .setUrlParams(AnalyticsParams)
      .addSuccess(PlatformAnalyticsResult)
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
