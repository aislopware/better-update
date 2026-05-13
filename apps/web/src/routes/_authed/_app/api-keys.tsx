import { Button } from "@better-update/ui/components/ui/button";
import { CardFrame, CardFrameHeader, CardFrameTitle } from "@better-update/ui/components/ui/card";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyIcon } from "lucide-react";
import { Suspense, useState } from "react";

import { PageHeader } from "../../../components/page-header";
import { ListItemsSkeleton } from "../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { pluralize } from "../../../lib/pluralize";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { apiKeysQueryOptions } from "../../../queries/api-keys";
import { CreateApiKeyDialog, RevokeDialog } from "./-api-key-dialogs";
import { ApiKeysEmptyState, ApiKeysTable } from "./-api-keys-table";

const ApiKeysSkeleton = () => (
  <CardFrame>
    <CardFrameHeader>
      <Skeleton className="h-4 w-16 rounded" />
    </CardFrameHeader>
    <div className="px-6 py-2">
      <ListItemsSkeleton rows={3} hasTrailingButton={false} />
    </div>
  </CardFrame>
);

interface CreateApiKeyButtonProps {
  readonly orgId: string;
}

const CreateApiKeyButton = ({ orgId }: CreateApiKeyButtonProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <KeyIcon strokeWidth={2} data-icon="inline-start" />
        Create API key
      </Button>
      <CreateApiKeyDialog orgId={orgId} open={open} onOpenChange={setOpen} />
    </>
  );
};

const ApiKeysContent = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
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
    <>
      {apiKeys.length === 0 ? (
        <ApiKeysEmptyState />
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
    </>
  );
};

const ApiKeysPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Authenticate requests to the management API and CLI."
        actions={<CreateApiKeyButton orgId={orgId} />}
      />
      <Suspense fallback={<ApiKeysSkeleton />}>
        <ApiKeysContent orgId={orgId} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/api-keys")({
  component: ApiKeysPage,
});
