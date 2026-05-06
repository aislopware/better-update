import { createFileRoute } from "@tanstack/react-router";

import { UpdatesTab } from "../-updates-tab";

const UpdatesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <UpdatesTab orgId={activeOrg.id} projectId={project.id} slug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/updates/")({
  component: UpdatesPage,
});
