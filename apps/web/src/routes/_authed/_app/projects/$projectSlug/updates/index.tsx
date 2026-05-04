import {
  branchesInfiniteQueryOptions,
  channelsInfiniteQueryOptions,
  updatesInfiniteQueryOptions,
} from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { UpdatesTab } from "../-updates-tab";

const UpdatesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <UpdatesTab orgId={activeOrg.id} projectId={project.id} slug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/updates/")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    const projectId = context.project.id;
    await Promise.all([
      context.queryClient.ensureInfiniteQueryData(updatesInfiniteQueryOptions(orgId, projectId)),
      context.queryClient.ensureInfiniteQueryData(
        branchesInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
      ),
      context.queryClient.ensureInfiniteQueryData(
        channelsInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
      ),
    ]);
  },
  component: UpdatesPage,
});
