import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MonitorIcon } from "lucide-react";

import { SettingCard } from "../../../../components/setting-card";
import { ListItemsSkeleton, SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { RelativeTime } from "../../../../lib/relative-time";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { parseUserAgent } from "../../../../lib/user-agent";
import { sessionQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";

const SessionsList = () => {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions);
  const { data: currentSession } = useSuspenseQuery(sessionQueryOptions);
  const currentToken = currentSession?.session.token;

  const revokeMutation = useApiMutation({
    mutationFn: async (token: string) =>
      rejectOnAuthClientError(authClient.revokeSession({ token }), "Failed to revoke session"),
    onSuccess: async () => {
      toastManager.add({ title: "Session revoked", type: "success" });
      await queryClient.resetQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
  });

  const revokeAllMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(authClient.revokeOtherSessions(), "Failed to revoke sessions"),
    onSuccess: async () => {
      toastManager.add({ title: "All other sessions revoked", type: "success" });
      await queryClient.resetQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
  });

  const revokingToken = revokeMutation.isPending ? revokeMutation.variables : undefined;
  const isRevokingAll = revokeAllMutation.isPending;

  return (
    <SettingCard
      title="Active sessions"
      description="Devices currently signed in to your account."
      action={
        sessions.length > 1 ? (
          <Button
            variant="outline"
            onClick={() => {
              revokeAllMutation.mutate();
            }}
            loading={isRevokingAll}
          >
            Revoke all others
          </Button>
        ) : null
      }
    >
      <ul className="-my-3 flex flex-col divide-y">
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          const isRevoking = revokingToken === session.token;
          return (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <span className="bg-muted/72 flex size-9 shrink-0 items-center justify-center rounded-md border">
                <MonitorIcon strokeWidth={2} className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm leading-none font-medium">
                    {session.userAgent ? parseUserAgent(session.userAgent) : "Unknown device"}
                  </span>
                  {isCurrent ? <Badge variant="success">This device</Badge> : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {session.ipAddress ?? "Unknown IP"} · Signed in{" "}
                  <RelativeTime value={new Date(session.createdAt)} />
                </span>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="outline"
                  onClick={() => {
                    revokeMutation.mutate(session.token);
                  }}
                  loading={isRevoking}
                  disabled={isRevokingAll || (revokeMutation.isPending && !isRevoking)}
                >
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </SettingCard>
  );
};

const SessionsPagePending = () => (
  <SettingCardSkeleton hasFooter={false}>
    <ListItemsSkeleton rows={3} />
  </SettingCardSkeleton>
);

export const Route = createFileRoute("/_authed/_app/account/sessions")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionsQueryOptions);
  },
  pendingComponent: SessionsPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: SessionsList,
});
