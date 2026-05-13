import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon, KeyRoundIcon, Loader2Icon } from "lucide-react";
import { Suspense, useState } from "react";

import type { LucideIcon } from "lucide-react";

import { SettingCard } from "../../../../components/setting-card";
import { ListItemsSkeleton, SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient } from "../../../../lib/auth-client";
import { accountsQueryOptions } from "../../../../queries/auth";

interface ProviderMeta {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "credential",
    label: "Email & password",
    description: "Sign in with your email address and password.",
    icon: KeyRoundIcon,
  },
  {
    id: "github",
    label: "GitHub",
    description: "Sign in via GitHub OAuth.",
    icon: GitBranchIcon,
  },
];

const ConnectionsList = () => {
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
      toastManager.add({ title: error.message ?? "Failed to unlink account", type: "error" });
      return;
    }
    toastManager.add({ title: "Account unlinked", type: "success" });
    await queryClient.resetQueries({ queryKey: ["auth", "accounts"] });
  };

  const handleLinkGithub = async () => {
    if (isLinking) {
      return;
    }
    setIsLinking(true);
    const { error } = await authClient.linkSocial({
      provider: "github",
      callbackURL: "/account/connections",
    });
    if (error) {
      setIsLinking(false);
    }
  };

  return (
    <SettingCard
      title="Connections"
      description="Linked sign-in methods. You must keep at least one active."
    >
      <ul className="-my-3 flex flex-col divide-y">
        {PROVIDERS.map((provider) => {
          const linked = accounts.find((account) => account.providerId === provider.id);
          const isLinked = Boolean(linked);
          const isUnlinking = unlinkingProvider === provider.id;
          const canUnlink = isLinked && provider.id !== "credential" && accounts.length > 1;
          return (
            <li key={provider.id} className="flex items-center gap-3 py-3">
              <span className="bg-muted/72 flex size-9 shrink-0 items-center justify-center rounded-md border">
                <provider.icon strokeWidth={2} className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm leading-none font-medium">{provider.label}</span>
                <span className="text-muted-foreground text-xs">{provider.description}</span>
              </div>
              {provider.id === "github" && !isLinked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLinkGithub}
                  disabled={isLinking}
                  aria-busy={isLinking}
                >
                  {isLinking ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  {isLinking ? "Redirecting…" : "Connect"}
                </Button>
              ) : null}
              {canUnlink ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => handleUnlink(provider.id)}
                  disabled={Boolean(unlinkingProvider)}
                  aria-busy={isUnlinking}
                >
                  {isUnlinking ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  {isUnlinking ? "Unlinking…" : "Disconnect"}
                </Button>
              ) : null}
              {isLinked && !canUnlink ? (
                <span className="text-muted-foreground text-xs">Connected</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SettingCard>
  );
};

const ConnectionsPage = () => (
  <Suspense
    fallback={
      <SettingCardSkeleton hasFooter={false}>
        <ListItemsSkeleton rows={2} />
      </SettingCardSkeleton>
    }
  >
    <ConnectionsList />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/account/connections")({
  component: ConnectionsPage,
});
