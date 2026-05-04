import {
  branchesInfiniteQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  buildsInfiniteQueryOptions,
  channelsInfiniteQueryOptions,
} from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { ChannelsTab } from "../-channels-tab";

const ChannelsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <ChannelsTab orgId={activeOrg.id} projectId={project.id} projectSlug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    const projectId = context.project.id;
    await Promise.all([
      context.queryClient.ensureInfiniteQueryData(
        channelsInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
      ),
      context.queryClient.ensureInfiniteQueryData(
        branchesInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
      ),
      context.queryClient.ensureQueryData(buildCompatibilityMatrixQueryOptions(orgId, projectId)),
      context.queryClient.ensureInfiniteQueryData(buildsInfiniteQueryOptions(orgId, projectId)),
    ]);
  },
  component: ChannelsPage,
});
