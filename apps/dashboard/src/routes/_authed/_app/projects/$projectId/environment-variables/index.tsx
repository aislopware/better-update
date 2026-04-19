import { createFileRoute } from "@tanstack/react-router";

import { EnvVarsTab } from "../-env-vars-tab";

const EnvironmentVariablesPage = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();

  return <EnvVarsTab orgId={activeOrg.id} projectId={projectId} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/environment-variables/")({
  component: EnvironmentVariablesPage,
});
