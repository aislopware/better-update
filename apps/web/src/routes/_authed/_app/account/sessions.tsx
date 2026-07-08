import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@better-update/ui/components/ui/item";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
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
            disabled={isRevokingAll}
          >
            {isRevokingAll && <Spinner data-icon="inline-start" />}
            Revoke all others
          </Button>
        ) : null
      }
    >
      <ItemGroup>
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          const isRevoking = revokingToken === session.token;
          return (
            <Item key={session.id} variant="outline" size="sm">
              <ItemMedia variant="icon" className="bg-muted/72 size-8 rounded-md border">
                <MonitorIcon strokeWidth={2} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {session.userAgent ? parseUserAgent(session.userAgent) : "Unknown device"}
                  {isCurrent ? <Badge variant="success">This device</Badge> : null}
                </ItemTitle>
                <ItemDescription>
                  {displayIp(session.ipAddress) ? `${displayIp(session.ipAddress)} · ` : ""}
                  Signed in <RelativeTime value={session.createdAt} />
                </ItemDescription>
              </ItemContent>
              {isCurrent ? null : (
                <ItemActions>
                  <Button
                    variant="outline"
                    onClick={() => {
                      revokeMutation.mutate(session.token);
                    }}
                    disabled={isRevoking || isRevokingAll || revokeMutation.isPending}
                  >
                    {isRevoking && <Spinner data-icon="inline-start" />}
                    Revoke
                  </Button>
                </ItemActions>
              )}
            </Item>
          );
        })}
      </ItemGroup>
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
