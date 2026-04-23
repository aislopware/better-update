import { buildCompatibilityMatrixQueryOptions } from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { BuildsTab } from "../-builds-tab";

const BuildsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <BuildsTab orgId={activeOrg.id} projectId={project.id} projectSlug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/builds/")({
  loader: async ({ context }) => {
    const projectId = context.project.id;
    await context.queryClient.ensureQueryData(
      buildCompatibilityMatrixQueryOptions(context.activeOrg.id, projectId),
    );
  },
  component: BuildsPage,
});
