import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { PageHeader } from "../../../../components/page-header";
import { fireAndForget } from "../../../../lib/data-table";
import { EnvVarsView, envVarsSearchSchema } from "./-env-vars-view";
import { EnvironmentsManager } from "./-environments-manager";

const GlobalEnvironmentVariablesPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Global environment variables"
        description="Organization-wide variables available to all projects. Projects can override a global by defining a variable with the same key."
      />
      <EnvironmentsManager orgId={activeOrg.id} />
      <EnvVarsView
        mode={{ kind: "global", orgId: activeOrg.id }}
        search={search}
        onChangeSearch={(next) => {
          fireAndForget(navigate({ to: ".", search: next }));
        }}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/environment-variables/")({
  validateSearch: zodValidator(envVarsSearchSchema),
  component: GlobalEnvironmentVariablesPage,
});
