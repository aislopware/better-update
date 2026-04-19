import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsTab } from "./-analytics-tab";

const ProjectOverview = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();

  return <AnalyticsTab orgId={activeOrg.id} projectId={projectId} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/")({
  component: ProjectOverview,
});
