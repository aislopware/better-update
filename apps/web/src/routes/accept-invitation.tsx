import { useMountEffect } from "@better-update/react-hooks";
import { Button } from "@better-update/ui/components/ui/button";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { CheckCircle2Icon, MailWarningIcon } from "lucide-react";
import { z } from "zod";

import { GlobalLoading } from "../components/global-loading";
import { authClient, rejectOnAuthClientError } from "../lib/auth-client";
import { useApiMutation } from "../lib/use-api-mutation";
import { orgsQueryOptions, sessionQueryOptions } from "../queries/auth";

const acceptSearchSchema = z.object({
  id: z.string().min(1),
});

const AcceptInvitationPage = () => {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accept = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(
        authClient.organization.acceptInvitation({ invitationId: id }),
        "Failed to accept invitation",
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgsQueryOptions.queryKey });
      await navigate({ to: "/" });
    },
  });

  const { mutate, isPending, isSuccess, isError, error } = accept;

  useMountEffect(() => {
    mutate();
  });

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Body isError={isError} isSuccess={isSuccess} isPending={isPending} error={error} />
      </div>
    </div>
  );
};

interface BodyProps {
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly isPending: boolean;
  readonly error: unknown;
}

const Body = ({ isError, isSuccess, isPending, error }: BodyProps) => {
  if (isError) {
    return (
      <FailedState
        message={error instanceof Error ? error.message : "Failed to accept invitation"}
      />
    );
  }
  if (isSuccess) {
    return <SuccessState />;
  }
  return <PendingState isPending={isPending} />;
};

const PendingState = ({ isPending }: { readonly isPending: boolean }) => (
  <>
    <Spinner className="text-muted-foreground size-8" data-state={isPending ? "pending" : "idle"} />
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-foreground text-xl font-semibold">Accepting invitation</h1>
      <p className="text-muted-foreground text-sm">Hang on while we add you to the organization.</p>
    </div>
  </>
);

const SuccessState = () => (
  <>
    <CheckCircle2Icon className="text-primary size-8" />
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-foreground text-xl font-semibold">Invitation accepted</h1>
      <p className="text-muted-foreground text-sm">Redirecting you to your dashboard…</p>
    </div>
  </>
);

const FailedState = ({ message }: { readonly message: string }) => (
  <>
    <MailWarningIcon className="text-destructive size-8" />
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-foreground text-xl font-semibold">
        Could not accept invitation
      </h1>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
    <Button render={<Link to="/" />}>Go to dashboard</Button>
  </>
);

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: zodValidator(acceptSearchSchema),
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient
      .ensureQueryData(sessionQueryOptions)
      // eslint-disable-next-line promise/prefer-await-to-then -- ensureQueryData rejects on network error; we treat that as "not authed" and fall through to redirect
      .catch(() => null);
    if (!session?.user) {
      // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed search-param inference
      throw redirect({
        to: "/auth/login",
        search: { redirectTo: location.href },
      });
    }
  },
  pendingComponent: GlobalLoading,
  pendingMs: 0,
  pendingMinMs: 0,
  component: AcceptInvitationPage,
});
