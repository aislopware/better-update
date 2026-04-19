import { buildCompatibilityMatrixQueryOptions } from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { BuildsTab } from "../-builds-tab";

const BuildsPage = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();

  return <BuildsTab orgId={activeOrg.id} projectId={projectId} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/builds/")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      buildCompatibilityMatrixQueryOptions(context.activeOrg.id, params.projectId),
    );
  },
  component: BuildsPage,
});
