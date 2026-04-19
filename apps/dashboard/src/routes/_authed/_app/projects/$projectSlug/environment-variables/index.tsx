import { createFileRoute } from "@tanstack/react-router";

import { EnvVarsTab } from "../-env-vars-tab";

const EnvironmentVariablesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <EnvVarsTab orgId={activeOrg.id} projectId={project.id} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/environment-variables/")({
  component: EnvironmentVariablesPage,
});
