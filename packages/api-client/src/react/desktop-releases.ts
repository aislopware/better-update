import { queryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

export const buildDesktopReleasesQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId, "desktop-releases"] as const;

/**
 * The update-feed releases of one macOS build — one per channel at most, so a
 * single page covers them.
 */
export const buildDesktopReleasesQueryOptions = (
  orgId: string,
  projectId: string,
  buildId: string,
) =>
  queryOptions({
    queryKey: buildDesktopReleasesQueryKey(orgId, buildId),
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.desktopReleases.list({ params: { projectId }, query: { buildId, limit: 100 } }),
        signal,
      ),
    staleTime: 30_000,
  });
