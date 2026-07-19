import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { ClockIcon } from "lucide-react";

import { BrandWordmark } from "../components/brand-mark";
import { GlobalLoading } from "../components/global-loading";
import { StatusMedallion } from "../components/status-medallion";
import { isApprovedUser } from "../lib/access";
import { logout } from "../lib/logout";
import { useApiMutation } from "../lib/use-api-mutation";
import { sessionQueryOptions } from "../queries/auth";

const PendingApproval = () => {
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();

  const logoutMutation = useApiMutation({
    mutationFn: async () => logout(queryClient),
  });

  return (
    <div className="bg-background relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <BrandWordmark />
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <StatusMedallion tone="warning">
              <ClockIcon strokeWidth={1.5} />
            </StatusMedallion>
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-xl font-semibold">Account pending approval</CardTitle>
              <CardDescription>
                Better Update is still in development and access is invite-only. Your account (
                <span className="font-medium">{user.email}</span>) is waiting for a superadmin to
                approve it. You&apos;ll be able to sign in once it&apos;s approved.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              className="mt-2"
              disabled={logoutMutation.isPending}
              onClick={() => {
                logoutMutation.mutate();
              }}
            >
              {logoutMutation.isPending && <Spinner data-icon="inline-start" />}
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/pending-approval")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    /* eslint-disable functional/no-try-statements, functional/no-let, functional/no-promise-reject, functional/no-throw-statements, typescript/only-throw-error, init-declarations -- TanStack Router idiom: beforeLoad throws redirect Responses; coerce non-Error rejects so the CatchBoundary renders */
    let session;
    try {
      session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    } catch (error) {
      if (isRedirect(error)) {
        throw error;
      }
      throw redirect({ to: "/auth/login", search: { redirectTo: "/pending-approval" } });
    }
    if (!session?.user) {
      throw redirect({ to: "/auth/login", search: { redirectTo: "/pending-approval" } });
    }
    // Already approved → no reason to sit here.
    if (isApprovedUser(session.user)) {
      throw redirect({ to: "/" });
    }
    /* eslint-enable functional/no-try-statements, functional/no-let, functional/no-promise-reject, functional/no-throw-statements, typescript/only-throw-error, init-declarations */
    return { user: session.user };
  },
  pendingComponent: GlobalLoading,
  component: PendingApproval,
});
