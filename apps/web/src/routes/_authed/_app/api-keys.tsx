import { revokeApiKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyIcon } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../../../components/page-header";
import { TableSkeleton } from "../../../components/skeletons";
import { pluralize } from "../../../lib/pluralize";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { apiKeysQueryOptions } from "../../../queries/api-keys";
import { CreateApiKeyDialog, RevokeDialog } from "./-api-key-dialogs";
import { ApiKeyPoliciesDialog } from "./-api-key-policies-dialog";
import { ApiKeysEmptyState, ApiKeysTable } from "./-api-keys-table";

const ApiKeysSkeleton = () => <TableSkeleton columns={4} rows={3} />;

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
  const [managePoliciesKeyId, setManagePoliciesKeyId] = useState<string | null>(null);
  const managePoliciesKey = apiKeys.find((key) => key.id === managePoliciesKeyId);

  const revokeKeyMutation = useApiMutation({
    mutationFn: async (keyId: string) => revokeApiKey(keyId),
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
        <ApiKeysTable
          apiKeys={apiKeys}
          countLabel={`${apiKeys.length} ${pluralize(apiKeys.length, "key")}`}
          onManagePolicies={setManagePoliciesKeyId}
          onRevoke={setRevokeKeyId}
        />
      )}

      {managePoliciesKey ? (
        <ApiKeyPoliciesDialog
          orgId={orgId}
          apiKeyId={managePoliciesKey.id}
          apiKeyName={managePoliciesKey.name ?? "Unnamed key"}
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setManagePoliciesKeyId(null);
            }
          }}
        />
      ) : null}

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
      <ApiKeysContent orgId={orgId} />
    </div>
  );
};

const ApiKeysPagePending = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="API keys"
      description="Authenticate requests to the management API and CLI."
    />
    <ApiKeysSkeleton />
  </div>
);

export const Route = createFileRoute("/_authed/_app/api-keys")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(apiKeysQueryOptions(context.activeOrg.id));
  },
  pendingComponent: ApiKeysPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ApiKeysPage,
});
