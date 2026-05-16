import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { fireAndForget } from "../../../../../lib/data-table";
import { AnalyticsTab, analyticsSearchSchema } from "./-analytics-tab";

const ProjectOverview = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <AnalyticsTab
      orgId={activeOrg.id}
      projectId={project.id}
      search={search}
      onSearchChange={(next) => {
        fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) }));
      }}
    />
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/")({
  validateSearch: zodValidator(analyticsSearchSchema),
  component: ProjectOverview,
});
