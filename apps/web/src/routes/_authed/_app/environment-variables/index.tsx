import { createFileRoute } from "@tanstack/react-router";

import { EnvVarsView } from "./-env-vars-view";

const GlobalEnvironmentVariablesPage = () => {
  const { activeOrg } = Route.useRouteContext();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Global environment variables</h1>
        <p className="text-muted-foreground text-sm">
          Organization-wide variables available to all projects. Projects can override a global by
          defining a variable with the same key.
        </p>
      </header>
      <EnvVarsView mode={{ kind: "global", orgId: activeOrg.id }} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/environment-variables/")({
  component: GlobalEnvironmentVariablesPage,
});
