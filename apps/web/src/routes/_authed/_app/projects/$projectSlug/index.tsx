import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsTab } from "./-analytics-tab";

const ProjectOverview = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <AnalyticsTab orgId={activeOrg.id} projectId={project.id} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/")({
  component: ProjectOverview,
});
