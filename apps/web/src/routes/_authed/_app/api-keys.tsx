import { CardFrame, CardFrameHeader, CardFrameTitle } from "@better-update/ui/components/ui/card";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "../../../components/page-header";
import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { pluralize } from "../../../lib/pluralize";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { apiKeysQueryOptions } from "../../../queries/api-keys";
import { CreateApiKeyDialog, RevokeDialog } from "./-api-key-dialogs";
import { ApiKeysEmptyState, ApiKeysTable } from "./-api-keys-table";

const ApiKeys = () => {
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const { data: apiKeys } = useSuspenseQuery(apiKeysQueryOptions(orgId));

  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);

  const revokeKeyMutation = useApiMutation({
    mutationFn: async (keyId: string) =>
      rejectOnAuthClientError(authClient.apiKey.delete({ keyId }), "Failed to revoke API key"),
    onSuccess: async () => {
      setRevokeKeyId(null);
      toastManager.add({ title: "API key revoked", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: apiKeysQueryOptions(orgId).queryKey,
      });
    },
  });

  const handleRevoke = () => {
    if (!revokeKeyId) {
      return;
    }
    revokeKeyMutation.mutate(revokeKeyId);
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Authenticate requests to the management API and CLI."
        actions={apiKeys.length > 0 ? <CreateApiKeyDialog orgId={orgId} /> : undefined}
      />

      {apiKeys.length === 0 ? (
        <ApiKeysEmptyState>
          <CreateApiKeyDialog orgId={orgId} />
        </ApiKeysEmptyState>
      ) : (
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>
              {apiKeys.length} {pluralize(apiKeys.length, "key")}
            </CardFrameTitle>
          </CardFrameHeader>
          <ApiKeysTable apiKeys={apiKeys} onRevoke={setRevokeKeyId} />
        </CardFrame>
      )}

      <RevokeDialog
        open={revokeKeyId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRevokeKeyId(null);
          }
        }}
        onConfirm={handleRevoke}
        isRevoking={revokeKeyMutation.isPending}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/api-keys")({
  component: ApiKeys,
});
