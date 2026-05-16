import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { fireAndForget } from "../../../../lib/data-table";
import { EnvVarsView, envVarsSearchSchema } from "./-env-vars-view";

const GlobalEnvironmentVariablesPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Global environment variables</h1>
        <p className="text-muted-foreground text-sm">
          Organization-wide variables available to all projects. Projects can override a global by
          defining a variable with the same key.
        </p>
      </header>
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
