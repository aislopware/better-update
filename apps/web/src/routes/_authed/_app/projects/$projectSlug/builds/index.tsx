import { createFileRoute } from "@tanstack/react-router";

import { BuildsTab } from "../-builds-tab";

const BuildsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <BuildsTab orgId={activeOrg.id} projectId={project.id} projectSlug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/builds/")({
  component: BuildsPage,
});
