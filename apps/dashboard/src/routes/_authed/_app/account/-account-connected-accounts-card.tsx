import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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

  const handleUnlink = async (providerId: string) => {
    const { error } = await authClient.unlinkAccount({ providerId });

    if (error) {
      toast.error(error.message ?? "Failed to unlink account");
      return;
    }

    toast.success("Account unlinked");
    await queryClient.resetQueries({ queryKey: ["auth", "accounts"] });
  };

  const handleLinkGithub = async () => {
    await authClient.linkSocial({ provider: "github", callbackURL: "/account" });
  };

  const hasGithub = accounts.some((account) => account.providerId === "github");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Manage your linked sign-in providers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between">
            <span className="text-sm">
              {PROVIDER_LABELS[account.providerId] ?? account.providerId}
            </span>
            {account.providerId === "credential" ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={accounts.length <= 1}
                onClick={async () => handleUnlink(account.providerId)}
              >
                Unlink
              </Button>
            )}
          </div>
        ))}
        {hasGithub ? null : (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">GitHub</span>
            <Button variant="outline" size="sm" onClick={handleLinkGithub}>
              Link GitHub
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
