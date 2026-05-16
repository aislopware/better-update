import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { fireAndForget } from "../../../../../../lib/data-table";
import { EnvVarsView, envVarsSearchSchema } from "../../../environment-variables/-env-vars-view";

const EnvironmentVariablesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <EnvVarsView
      mode={{ kind: "project", orgId: activeOrg.id, projectId: project.id }}
      search={search}
      onChangeSearch={(next) => {
        fireAndForget(navigate({ to: ".", search: next }));
      }}
    />
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/environment-variables/")({
  validateSearch: zodValidator(envVarsSearchSchema),
  component: EnvironmentVariablesPage,
});
