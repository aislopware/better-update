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

import { authClient } from "../lib/auth-client";
import {
  buildCliApiKeyName,
  buildCliCallbackRedirect,
  buildCliLoginRedirectTarget,
  isAllowedCliCallbackUrl,
} from "../lib/cli-login";
import { orgsQueryOptions } from "../queries/auth";

const CliLoginPage = () => {
  const { callbackRedirectUrl, error } = Route.useRouteContext();

  if (callbackRedirectUrl) {
    globalThis.location.replace(callbackRedirectUrl);
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Connect CLI</CardTitle>
          <CardDescription>The browser login could not finish.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-destructive">{error}</p>
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

export const Route = createFileRoute("/cli-login")({
  validateSearch: (search) => ({
    callbackUrl: typeof search["callbackUrl"] === "string" ? search["callbackUrl"] : "",
  }),
  beforeLoad: async ({ context, search }) => {
    if (!search.callbackUrl || !isAllowedCliCallbackUrl(search.callbackUrl)) {
      return { callbackRedirectUrl: null, error: "Invalid CLI callback URL." };
    }

    if (!context.session?.user) {
      throw redirect({
        to: "/login",
        search: { redirectTo: buildCliLoginRedirectTarget(search.callbackUrl) },
      });
    }

    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);
    const activeOrganizationId = context.session.session.activeOrganizationId ?? orgs[0]?.id;

    if (!activeOrganizationId) {
      return {
        callbackRedirectUrl: null,
        error: "No organization is available for CLI login yet.",
      };
    }

    if (!context.session.session.activeOrganizationId) {
      const { error } = await authClient.organization.setActive({
        organizationId: activeOrganizationId,
      });
      if (error) {
        return {
          callbackRedirectUrl: null,
          error: error.message ?? "Failed to select an organization for CLI login.",
        };
      }
    }

    const { data, error } = await authClient.apiKey.create({
      name: buildCliApiKeyName(),
      organizationId: activeOrganizationId,
    });

    if (error || !data.key) {
      return {
        callbackRedirectUrl: null,
        error: error?.message ?? "Failed to create a CLI API key.",
      };
    }

    return {
      callbackRedirectUrl: buildCliCallbackRedirect(search.callbackUrl, data.key),
      error: null,
    };
  },
  component: CliLoginPage,
});
