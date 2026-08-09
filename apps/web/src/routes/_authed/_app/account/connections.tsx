import { Button } from "@better-update/ui/components/button";
import { toast } from "@better-update/ui/components/toast";
import { GitBranchIcon, KeyIcon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import type { Icon } from "@phosphor-icons/react";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { ListPanel, ListPanelRow } from "../../../../lib/data-table";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { accountsQueryOptions } from "../../../../queries/auth";

interface ProviderMeta {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: Icon;
}

const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "credential",
    label: "Email & password",
    description: "Sign in with your email address and password.",
    icon: KeyIcon,
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
    <>
      <PageHeader
        title="Connections"
        description="Linked sign-in methods. You must keep at least one active."
      />
      <ListPanel>
        {PROVIDERS.map((provider) => {
          const linked = accounts.find((account) => account.providerId === provider.id);
          const isLinked = Boolean(linked);
          const isUnlinking = unlinkingProvider === provider.id;
          const canUnlink = isLinked && provider.id !== "credential" && accounts.length > 1;
          return (
            <ListPanelRow
              key={provider.id}
              media={<provider.icon weight="bold" />}
              title={<span className="truncate">{provider.label}</span>}
              description={provider.description}
              actions={
                <>
                  {provider.id === "github" && !isLinked ? (
                    <Button
                      variant="secondary"
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
                      variant="ghost"
                      onClick={() => {
                        unlinkMutation.mutate(provider.id);
                      }}
                      disabled={isUnlinking || unlinkMutation.isPending}
                      loading={isUnlinking}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                  {isLinked && !canUnlink ? (
                    <span className="text-kumo-subtle text-xs">Connected</span>
                  ) : null}
                </>
              }
            />
          );
        })}
      </ListPanel>
    </>
  );
};

const ConnectionsPagePending = () => (
  <>
    <PageHeader
      title="Connections"
      description="Linked sign-in methods. You must keep at least one active."
    />
    <TableSkeleton columns={2} rows={2} hasFooter={false} />
  </>
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
