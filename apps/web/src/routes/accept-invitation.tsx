import { useMountEffect } from "@better-update/react-hooks";
import { LinkButton } from "@better-update/ui/components/button";
import { Loader } from "@better-update/ui/components/loader";
import { CheckCircleIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { CenteredCardBody, CenteredCardPage } from "../components/centered-card-page";
import { GlobalLoading } from "../components/global-loading";
import { StatusMedallion } from "../components/status-medallion";
import { authClient, rejectOnAuthClientError } from "../lib/auth-client";
import { useApiMutation } from "../lib/use-api-mutation";
import { orgsQueryOptions, sessionQueryOptions } from "../queries/auth";

const acceptSearchSchema = z.object({
  id: z.string().min(1),
});

const AcceptInvitationPage = () => {
  const { id } = Route.useSearch();
  const navigate = Route.useNavigate();
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
    <CenteredCardPage>
      <CenteredCardBody>
        <Body isError={isError} isSuccess={isSuccess} isPending={isPending} error={error} />
      </CenteredCardBody>
    </CenteredCardPage>
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
    <StatusMedallion tone="neutral">
      <Loader size={24} data-state={isPending ? "pending" : "idle"} />
    </StatusMedallion>
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-kumo-default text-xl font-semibold">Accepting invitation</h1>
      <p className="text-kumo-subtle text-sm">Hang on while we add you to the organization.</p>
    </div>
  </>
);

const SuccessState = () => (
  <>
    <StatusMedallion tone="success">
      <CheckCircleIcon />
    </StatusMedallion>
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-kumo-default text-xl font-semibold">Invitation accepted</h1>
      <p className="text-kumo-subtle text-sm">Redirecting you to your dashboard…</p>
    </div>
  </>
);

const FailedState = ({ message }: { readonly message: string }) => (
  <>
    <StatusMedallion tone="destructive">
      <EnvelopeSimpleIcon />
    </StatusMedallion>
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-kumo-default text-xl font-semibold">
        Could not accept invitation
      </h1>
      <p className="text-kumo-subtle text-sm">{message}</p>
    </div>
    <LinkButton variant="primary" className="mt-2" href="/">
      Go to dashboard
    </LinkButton>
  </>
);

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: zodValidator(acceptSearchSchema),
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient
      .ensureQueryData(sessionQueryOptions)
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
