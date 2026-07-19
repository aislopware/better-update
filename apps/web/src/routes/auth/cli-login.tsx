import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { CircleAlertIcon } from "lucide-react";
import { z } from "zod";

import { BrandWordmark } from "../../components/brand-mark";
import { CliCommandBlock } from "../../components/cli-command-block";
import { StatusMedallion } from "../../components/status-medallion";
import { authClient } from "../../lib/auth-client";
import {
  buildCliCallbackRedirect,
  buildCliLoginRedirectTarget,
  isAllowedCliCallbackUrl,
} from "../../lib/cli-login";
import { orgsQueryOptions } from "../../queries/auth";

const cliLoginSearchSchema = z.object({
  // eslint-disable-next-line unicorn/prefer-top-level-await, promise/prefer-await-to-then -- zod's .catch() is a sync validator fallback, not a Promise handler
  callbackUrl: z.string().catch(""),
});

const RetryInstructions = () => (
  <div className="mt-2 flex w-full flex-col gap-2 text-left">
    <CliCommandBlock commands={["better-update login"]} />
    <p className="text-muted-foreground text-xs leading-relaxed">
      Return to your terminal and run the command again to retry. Need help? See the{" "}
      <a
        href="https://www.npmjs.com/package/@better-update/cli"
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline-offset-4 hover:underline"
      >
        CLI docs
      </a>
      .
    </p>
  </div>
);

const CliLoginPage = () => {
  const { error } = Route.useRouteContext();

  return (
    <div className="bg-background relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <BrandWordmark />
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <StatusMedallion tone="destructive">
              <CircleAlertIcon strokeWidth={1.5} />
            </StatusMedallion>
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-xl font-semibold">CLI login failed</CardTitle>
              <CardDescription>{error}</CardDescription>
            </div>
            <RetryInstructions />
            <Button
              variant="outline"
              onClick={() => {
                globalThis.location.assign("/");
              }}
            >
              Go to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/auth/cli-login")({
  validateSearch: zodValidator(cliLoginSearchSchema),
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
        fetchOptions: { disableSignal: true },
      });
      if (error) {
        return { error: error.message ?? "Failed to select an organization for CLI login." };
      }
    }

    const { data, error } = await authClient.oneTimeToken.generate();

    if (error || !data.token) {
      return { error: error?.message ?? "Failed to create a CLI login token." };
    }

    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- TanStack Router redirect for CLI callback (absolute external URL)
    throw redirect({ href: buildCliCallbackRedirect(search.callbackUrl, data.token) });
  },
  component: CliLoginPage,
});
