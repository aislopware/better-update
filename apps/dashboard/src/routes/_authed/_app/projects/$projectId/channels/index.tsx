import {
  branchesQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  channelsQueryOptions,
} from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { ChannelsTab } from "../-channels-tab";

const ChannelsPage = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();

  return <ChannelsTab orgId={activeOrg.id} projectId={projectId} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/channels/")({
  loader: async ({ context, params }) => {
    const orgId = context.activeOrg.id;
    await Promise.all([
      context.queryClient.ensureQueryData(channelsQueryOptions(orgId, params.projectId)),
      context.queryClient.ensureQueryData(branchesQueryOptions(orgId, params.projectId)),
      context.queryClient.ensureQueryData(
        buildCompatibilityMatrixQueryOptions(orgId, params.projectId),
      ),
    ]);
  },
  component: ChannelsPage,
});
