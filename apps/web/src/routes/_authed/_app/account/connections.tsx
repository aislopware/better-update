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
      toast.success("Account unlinked");
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
      <ItemGroup>
        {PROVIDERS.map((provider) => {
          const linked = accounts.find((account) => account.providerId === provider.id);
          const isLinked = Boolean(linked);
          const isUnlinking = unlinkingProvider === provider.id;
          const canUnlink = isLinked && provider.id !== "credential" && accounts.length > 1;
          return (
            <Item key={provider.id} variant="outline" size="sm">
              <ItemMedia variant="icon" className="bg-muted/72 size-8 rounded-md border">
                <provider.icon strokeWidth={2} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{provider.label}</ItemTitle>
                <ItemDescription>{provider.description}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {provider.id === "github" && !isLinked ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      linkGithubMutation.mutate();
                    }}
                    disabled={linkGithubMutation.isPending}
                  >
                    {linkGithubMutation.isPending && <Spinner data-icon="inline-start" />}
                    Connect
                  </Button>
                ) : null}
                {canUnlink ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      unlinkMutation.mutate(provider.id);
                    }}
                    disabled={isUnlinking || unlinkMutation.isPending}
                  >
                    {isUnlinking && <Spinner data-icon="inline-start" />}
                    Disconnect
                  </Button>
                ) : null}
                {isLinked && !canUnlink ? (
                  <span className="text-muted-foreground text-xs">Connected</span>
                ) : null}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
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
