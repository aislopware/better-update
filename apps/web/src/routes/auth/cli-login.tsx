import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "../../lib/auth-client";
import {
  buildCliApiKeyName,
  buildCliCallbackRedirect,
  buildCliLoginRedirectTarget,
  isAllowedCliCallbackUrl,
} from "../../lib/cli-login";
import { orgsQueryOptions } from "../../queries/auth";

interface CliLoginSearch {
  readonly callbackUrl: string;
}

const CliLoginPage = () => {
  const { error } = Route.useRouteContext();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Connect CLI</CardTitle>
          <CardDescription>The browser login could not finish.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p role="alert" className="text-destructive">
            {error}
          </p>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              globalThis.location.assign("/");
            }}
          >
            Go to dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/auth/cli-login")({
  validateSearch: (search): CliLoginSearch => ({
    callbackUrl: typeof search["callbackUrl"] === "string" ? search["callbackUrl"] : "",
  }),
  beforeLoad: async ({ context, search }) => {
    if (!search.callbackUrl || !isAllowedCliCallbackUrl(search.callbackUrl)) {
      return { error: "Invalid CLI callback URL." };
    }

    if (!context.session?.user) {
      // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- typed search-param inference on /auth/login requires inline redirect; the throwRedirect helper collapses generics
      throw redirect({
        to: "/auth/login",
        search: { redirectTo: buildCliLoginRedirectTarget(search.callbackUrl) },
      });
    }

    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);
    const activeOrganizationId = context.session.session.activeOrganizationId ?? orgs[0]?.id;

    if (!activeOrganizationId) {
      return { error: "No organization is available for CLI login yet." };
    }

    if (!context.session.session.activeOrganizationId) {
      const { error } = await authClient.organization.setActive({
        organizationId: activeOrganizationId,
      });
      if (error) {
        return { error: error.message ?? "Failed to select an organization for CLI login." };
      }
    }

    const { data, error } = await authClient.apiKey.create({
      name: buildCliApiKeyName(),
      organizationId: activeOrganizationId,
    });

    if (error || !data.key) {
      return { error: error?.message ?? "Failed to create a CLI API key." };
    }

    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- TanStack Router redirect for CLI callback (absolute external URL)
    throw redirect({ href: buildCliCallbackRedirect(search.callbackUrl, data.key) });
  },
  component: CliLoginPage,
});
