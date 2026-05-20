import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon, KeyRoundIcon } from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { SettingCard } from "../../../../components/setting-card";
import { ListItemsSkeleton, SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { useApiMutation } from "../../../../lib/use-api-mutation";
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

  const unlinkMutation = useApiMutation({
    mutationFn: async (providerId: string) =>
      rejectOnAuthClientError(authClient.unlinkAccount({ providerId }), "Failed to unlink account"),
    onSuccess: async () => {
      toastManager.add({ title: "Account unlinked", type: "success" });
      await queryClient.resetQueries({ queryKey: accountsQueryOptions.queryKey });
    },
  });

  const linkGithubMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(
        authClient.linkSocial({
          provider: "github",
          callbackURL: "/account/connections",
        }),
        "Failed to link GitHub",
      ),
  });

  const unlinkingProvider = unlinkMutation.isPending ? unlinkMutation.variables : undefined;

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
                  onClick={() => {
                    linkGithubMutation.mutate();
                  }}
                  loading={linkGithubMutation.isPending}
                >
                  Connect
                </Button>
              ) : null}
              {canUnlink ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    unlinkMutation.mutate(provider.id);
                  }}
                  loading={isUnlinking}
                  disabled={unlinkMutation.isPending && !isUnlinking}
                >
                  Disconnect
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

const ConnectionsPagePending = () => (
  <SettingCardSkeleton hasFooter={false}>
    <ListItemsSkeleton rows={2} />
  </SettingCardSkeleton>
);

export const Route = createFileRoute("/_authed/_app/account/connections")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(accountsQueryOptions);
  },
  pendingComponent: ConnectionsPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ConnectionsList,
});
