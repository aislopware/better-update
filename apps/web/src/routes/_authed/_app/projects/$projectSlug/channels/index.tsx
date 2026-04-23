import {
  branchesQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  channelsQueryOptions,
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
      context.queryClient.ensureQueryData(channelsQueryOptions(orgId, projectId)),
      context.queryClient.ensureQueryData(branchesQueryOptions(orgId, projectId)),
      context.queryClient.ensureQueryData(buildCompatibilityMatrixQueryOptions(orgId, projectId)),
    ]);
  },
  component: ChannelsPage,
});
