import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
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
      toast.success("API key revoked");
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
    <div className="flex w-full flex-col gap-4">
      <div className="flex justify-end">
        <CreateApiKeyDialog orgId={orgId} />
      </div>

      {apiKeys.length === 0 ? (
        <ApiKeysEmptyState />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Active keys</CardTitle>
            <CardDescription>
              {apiKeys.length} {apiKeys.length === 1 ? "key" : "keys"} in this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeysTable apiKeys={apiKeys} onRevoke={setRevokeKeyId} />
          </CardContent>
        </Card>
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
