import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import { toast } from "@better-update/ui/components/toast";
import { MonitorIcon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import {
  ClientPaginationBar,
  ListPanel,
  ListPanelFooter,
  useClientPagination,
} from "../../../../lib/data-table";
import { RelativeTime } from "../../../../lib/relative-time";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { parseUserAgent } from "../../../../lib/user-agent";
import { sessionQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";

// Local dev and some proxies record an all-zero address — showing it reads as
// a bug, so treat it as absent.
const displayIp = (ip: string | null | undefined): string | undefined => {
  if (!ip) {
    return undefined;
  }
  return /^[0:.]+$/u.test(ip) ? undefined : ip;
};

const SessionsList = () => {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions);
  const { data: currentSession } = useSuspenseQuery(sessionQueryOptions);
  const currentToken = currentSession?.session.token;
  const pagination = useClientPagination(sessions, "session");

  const revokeMutation = useApiMutation({
    mutationFn: async (token: string) =>
      rejectOnAuthClientError(authClient.revokeSession({ token }), "Failed to revoke session"),
    onSuccess: async () => {
      toast.success("Session revoked");
      await queryClient.resetQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
  });

  const revokeAllMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(authClient.revokeOtherSessions(), "Failed to revoke sessions"),
    onSuccess: async () => {
      toast.success("All other sessions revoked");
      await queryClient.resetQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
  });

  const revokingToken = revokeMutation.isPending ? revokeMutation.variables : undefined;
  const isRevokingAll = revokeAllMutation.isPending;

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Devices currently signed in to your account."
        actions={
          sessions.length > 1 ? (
            <Button
              variant="secondary"
              onClick={() => {
                revokeAllMutation.mutate();
              }}
              loading={isRevokingAll}
            >
              Revoke all others
            </Button>
          ) : null
        }
      />
      {/* One frame with hairlines between the rows, not a bordered box per
          session: an account signed in on twenty devices drew twenty boxes down
          a page, each one its own object to look at. A page of sessions is a
          list, and the count closes it like every other list here. */}
      <ListPanel>
        {pagination.pageItems.map((session) => {
          const isCurrent = session.token === currentToken;
          const isRevoking = revokingToken === session.token;
          return (
            <div
              key={session.id}
              className="border-kumo-line flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <MonitorIcon weight="bold" className="text-kumo-subtle size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">
                    {session.userAgent ? parseUserAgent(session.userAgent) : "Unknown device"}
                  </span>
                  {isCurrent ? <Badge variant="success">This device</Badge> : null}
                </span>
                <span className="text-kumo-subtle text-xs">
                  {displayIp(session.ipAddress) ? `${displayIp(session.ipAddress)} · ` : ""}
                  Signed in <RelativeTime value={session.createdAt} />
                </span>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    revokeMutation.mutate(session.token);
                  }}
                  disabled={isRevoking || isRevokingAll || revokeMutation.isPending}
                  loading={isRevoking}
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
        <ListPanelFooter>
          <ClientPaginationBar state={pagination} />
        </ListPanelFooter>
      </ListPanel>
    </>
  );
};

const SessionsPagePending = () => (
  <>
    <PageHeader title="Sessions" description="Devices currently signed in to your account." />
    <TableSkeleton columns={2} rows={4} />
  </>
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
