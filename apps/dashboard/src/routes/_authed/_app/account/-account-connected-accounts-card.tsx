import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "../../../../lib/auth-client";
import { accountsQueryOptions } from "../../../../queries/auth";

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Email & Password",
  github: "GitHub",
};

export const AccountConnectedAccountsCard = () => {
  const queryClient = useQueryClient();
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | undefined>(undefined);
  const [isLinking, setIsLinking] = useState(false);

  const handleUnlink = async (providerId: string) => {
    if (unlinkingProvider) {
      return;
    }
    setUnlinkingProvider(providerId);
    const { error } = await authClient.unlinkAccount({ providerId });
    setUnlinkingProvider(undefined);

    if (error) {
      toast.error(error.message ?? "Failed to unlink account");
      return;
    }

    toast.success("Account unlinked");
    await queryClient.resetQueries({ queryKey: ["auth", "accounts"] });
  };

  const handleLinkGithub = async () => {
    if (isLinking) {
      return;
    }
    setIsLinking(true);
    const { error } = await authClient.linkSocial({
      provider: "github",
      callbackURL: "/account",
    });
    if (error) {
      setIsLinking(false);
    }
  };

  const hasGithub = accounts.some((account) => account.providerId === "github");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Manage your linked sign-in providers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {accounts.map((account) => {
          const isUnlinking = unlinkingProvider === account.providerId;
          return (
            <div key={account.id} className="flex items-center justify-between">
              <span className="text-sm">
                {PROVIDER_LABELS[account.providerId] ?? account.providerId}
              </span>
              {account.providerId === "credential" ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={accounts.length <= 1 || Boolean(unlinkingProvider)}
                  aria-busy={isUnlinking}
                  onClick={async () => handleUnlink(account.providerId)}
                >
                  {isUnlinking ? (
                    <>
                      <Loader2Icon className="size-3.5 animate-spin" />
                      Unlinking…
                    </>
                  ) : (
                    "Unlink"
                  )}
                </Button>
              )}
            </div>
          );
        })}
        {hasGithub ? null : (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">GitHub</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLinkGithub}
              disabled={isLinking}
              aria-busy={isLinking}
            >
              {isLinking ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Redirecting…
                </>
              ) : (
                "Link GitHub"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
