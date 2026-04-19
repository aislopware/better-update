import {
  branchesQueryOptions,
  channelsQueryOptions,
  projectQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { UpdatesTab } from "../-updates-tab";

const UpdatesPage = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data: project } = useSuspenseQuery(projectQueryOptions(orgId, projectId));

  return <UpdatesTab orgId={orgId} projectId={projectId} scopeKey={project.scopeKey} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/updates/")({
  loader: async ({ context, params }) => {
    const orgId = context.activeOrg.id;
    await Promise.all([
      context.queryClient.ensureQueryData(updatesQueryOptions(orgId, params.projectId)),
      context.queryClient.ensureQueryData(branchesQueryOptions(orgId, params.projectId)),
      context.queryClient.ensureQueryData(channelsQueryOptions(orgId, params.projectId, 1000)),
    ]);
  },
  component: UpdatesPage,
});
