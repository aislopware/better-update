import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "../../../../lib/auth-client";
import { sessionQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";
import { parseUserAgent } from "./-user-agent";

export const AccountSessionsCard = () => {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions);
  const { data: currentSession } = useSuspenseQuery(sessionQueryOptions);
  const currentToken = currentSession?.session.token;

  const handleRevoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token });

    if (error) {
      toast.error(error.message ?? "Failed to revoke session");
      return;
    }

    toast.success("Session revoked");
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  const handleRevokeAll = async () => {
    const { error } = await authClient.revokeOtherSessions();

    if (error) {
      toast.error(error.message ?? "Failed to revoke sessions");
      return;
    }

    toast.success("All other sessions revoked");
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Manage your active sessions across devices.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          return (
            <div key={session.id} className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {session.userAgent ? parseUserAgent(session.userAgent) : "Unknown device"}
                  </span>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {session.ipAddress ?? "Unknown IP"} &middot;{" "}
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => handleRevoke(session.token)}
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={handleRevokeAll}>
          Revoke all other sessions
        </Button>
      </CardFooter>
    </Card>
  );
};
