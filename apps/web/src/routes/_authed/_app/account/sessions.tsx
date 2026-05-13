import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2Icon, MonitorIcon } from "lucide-react";
import { Suspense, useState } from "react";

import { SettingCard } from "../../../../components/setting-card";
import { ListItemsSkeleton, SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient } from "../../../../lib/auth-client";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { parseUserAgent } from "../../../../lib/user-agent";
import { sessionQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";

const SessionsList = () => {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions);
  const { data: currentSession } = useSuspenseQuery(sessionQueryOptions);
  const currentToken = currentSession?.session.token;
  const [revokingTokens, setRevokingTokens] = useState<ReadonlySet<string>>(() => new Set());
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  const setTokenRevoking = (token: string, active: boolean) => {
    setRevokingTokens((prev) => {
      const next = new Set(prev);
      if (active) {
        next.add(token);
      } else {
        next.delete(token);
      }
      return next;
    });
  };

  const handleRevoke = async (token: string) => {
    if (revokingTokens.has(token)) {
      return;
    }
    setTokenRevoking(token, true);
    const { error } = await authClient.revokeSession({ token });
    setTokenRevoking(token, false);
    if (error) {
      toastManager.add({ title: error.message ?? "Failed to revoke session", type: "error" });
      return;
    }
    toastManager.add({ title: "Session revoked", type: "success" });
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  const handleRevokeAll = async () => {
    if (isRevokingAll) {
      return;
    }
    setIsRevokingAll(true);
    const { error } = await authClient.revokeOtherSessions();
    setIsRevokingAll(false);
    if (error) {
      toastManager.add({ title: error.message ?? "Failed to revoke sessions", type: "error" });
      return;
    }
    toastManager.add({ title: "All other sessions revoked", type: "success" });
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  return (
    <SettingCard
      title="Active sessions"
      description="Devices currently signed in to your account."
      action={
        sessions.length > 1 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevokeAll}
            disabled={isRevokingAll}
            aria-busy={isRevokingAll}
          >
            {isRevokingAll ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {isRevokingAll ? "Revoking…" : "Revoke all others"}
          </Button>
        ) : null
      }
    >
      <ul className="-my-3 flex flex-col divide-y">
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          const isRevoking = revokingTokens.has(session.token);
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
                  {formatRelativeTime(new Date(session.createdAt).toISOString())}
                </span>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => handleRevoke(session.token)}
                  disabled={isRevoking || isRevokingAll}
                  aria-busy={isRevoking}
                >
                  {isRevoking ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  {isRevoking ? "Revoking…" : "Revoke"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </SettingCard>
  );
};

const SessionsPage = () => (
  <Suspense
    fallback={
      <SettingCardSkeleton hasFooter={false}>
        <ListItemsSkeleton rows={3} />
      </SettingCardSkeleton>
    }
  >
    <SessionsList />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/account/sessions")({
  component: SessionsPage,
});
