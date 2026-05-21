import {
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
  updateAndroidBuildCredentials,
} from "@better-update/api-client/react";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

const TITLE = "Change FCM v1 Service Account";
const DESCRIPTION =
  "Pick a saved service account. Applied across all credential groups for this app identifier.";

interface ChooseSavedTabProps {
  readonly orgId: string;
  readonly currentId: string | null;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const ChooseSavedTab = ({ orgId, currentId, selectedId, onSelect }: ChooseSavedTabProps) => {
  const { data: keys } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  if (keys.items.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved service accounts yet.
      </p>
    );
  }

  return (
    <RadioGroup
      value={selectedId}
      onValueChange={(value) => {
        onSelect(String(value));
      }}
    >
      <div className="flex flex-col gap-2">
        {keys.items.map((sa) => {
          const isCurrent = sa.id === currentId;
          return (
            <label
              key={sa.id}
              htmlFor={`gsa-${sa.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`gsa-${sa.id}`} value={sa.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium break-all">{sa.clientEmail}</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {sa.googleProjectId} · added {formatDate(sa.createdAt)}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface AndroidChangeGsaDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly applicationIdentifierId: string;
  readonly groupIds: readonly string[];
  readonly currentSa: GoogleServiceAccountKeyItem | null;
}

export const AndroidChangeGsaDialog = ({
  open,
  onOpenChange,
  orgId,
  applicationIdentifierId,
  groupIds,
  currentSa,
}: AndroidChangeGsaDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentSa === null ? "" : currentSa.id;
  const currentSaId: string | null = currentSa === null ? null : currentSa.id;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: googleServiceAccountKeysQueryOptions(orgId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId).queryKey,
      }),
    ]);
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ selectedId }: { selectedId: string }) => {
      await Promise.all(
        groupIds.map(async (groupId) =>
          updateAndroidBuildCredentials(groupId, { googleServiceAccountKeyForFcmV1Id: selectedId }),
        ),
      );
    },
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <ChangeCredentialDialog
      open={open}
      onOpenChange={onOpenChange}
      title={TITLE}
      description={DESCRIPTION}
      initialSelectedId={initialSelectedId}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading service accounts…</p>}
        >
          <ChooseSavedTab
            orgId={orgId}
            currentId={currentSaId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
    />
  );
};
