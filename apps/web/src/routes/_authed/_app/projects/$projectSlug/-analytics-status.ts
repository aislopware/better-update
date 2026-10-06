import {
  adoptionQueryOptions,
  desktopAnalyticsQueryOptions,
  platformAnalyticsQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQueries } from "@tanstack/react-query";

import type { AnalyticsPeriod } from "./-analytics-charts";

/**
 * What the section can draw, decided once for every card.
 *
 * `unavailable` is the read path being down; `empty` is the far more common
 * case of a project no device has checked into yet. `ready` says which of the
 * two kinds of traffic there is: OTA devices (the update cards) and desktop
 * apps polling the update feeds (the desktop card) — a desktop-only project
 * has no use for the OTA cards. Reads the same cache keys as the charts below,
 * so asking a beat early costs no extra request.
 */
export type AnalyticsStatus =
  | { readonly kind: "unavailable" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly ota: boolean; readonly desktop: boolean };

export const useAnalyticsStatus = (
  orgId: string,
  projectId: string,
  period: AnalyticsPeriod,
): AnalyticsStatus =>
  useSuspenseQueries({
    queries: [
      adoptionQueryOptions(orgId, projectId, period),
      platformAnalyticsQueryOptions(orgId, projectId, period),
      desktopAnalyticsQueryOptions(orgId, projectId, period),
    ],
    combine: ([adoption, platform, desktop]): AnalyticsStatus => {
      if (adoption.data.unavailable || platform.data.unavailable) {
        return { kind: "unavailable" };
      }
      const ota = adoption.data.updates.length > 0 || platform.data.platforms.length > 0;
      const hasDesktop = desktop.data.checks > 0 || desktop.data.releases.length > 0;
      return ota || hasDesktop ? { kind: "ready", ota, desktop: hasDesktop } : { kind: "empty" };
    },
  });
