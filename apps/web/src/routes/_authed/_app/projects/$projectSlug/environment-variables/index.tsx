import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { PageHeader } from "../../../../../../components/page-header";
import { fireAndForget } from "../../../../../../lib/data-table";
import { EnvVarsView, envVarsSearchSchema } from "../../../environment-variables/-env-vars-view";

// The organization page has carried a title all along; this one opened straight
// onto its toolbar, so the only thing naming it was the nav item behind you.
const EnvironmentVariablesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Environment variables"
        description="This project's variables, and the organization globals it inherits or overrides."
      />
      <EnvVarsView
        mode={{ kind: "project", orgId: activeOrg.id, projectId: project.id }}
        search={search}
        onChangeSearch={(next) => {
          fireAndForget(navigate({ to: ".", search: next }));
        }}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/environment-variables/")({
  validateSearch: zodValidator(envVarsSearchSchema),
  component: EnvironmentVariablesPage,
});
