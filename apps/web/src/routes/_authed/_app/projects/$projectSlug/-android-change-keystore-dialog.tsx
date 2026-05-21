import {
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  updateAndroidBuildCredentials,
} from "@better-update/api-client/react";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import type { AndroidUploadKeystoreItem } from "@better-update/api-client/react";

import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

interface ChooseSavedTabProps {
  readonly orgId: string;
  readonly currentId: string | null;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const ChooseSavedTab = ({ orgId, currentId, selectedId, onSelect }: ChooseSavedTabProps) => {
  const { data: keystores } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));

  if (keystores.items.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">No saved keystores yet.</p>
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
        {keystores.items.map((keystore) => {
          const isCurrent = keystore.id === currentId;
          return (
            <label
              key={keystore.id}
              htmlFor={`keystore-${keystore.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`keystore-${keystore.id}`} value={keystore.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{keystore.keyAlias}</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {keystore.sha256Fingerprint === null
                    ? "no SHA-256"
                    : `${keystore.sha256Fingerprint.slice(0, 24)}…`}
                  {" · added "}
                  {formatDate(keystore.createdAt)}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface AndroidChangeKeystoreDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly applicationIdentifierId: string;
  readonly buildCredentialsId: string;
  readonly currentKeystore: AndroidUploadKeystoreItem | null;
}

export const AndroidChangeKeystoreDialog = ({
  open,
  onOpenChange,
  orgId,
  applicationIdentifierId,
  buildCredentialsId,
  currentKeystore,
}: AndroidChangeKeystoreDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentKeystore === null ? "" : currentKeystore.id;
  const currentKeystoreId: string | null = currentKeystore === null ? null : currentKeystore.id;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: androidUploadKeystoresQueryOptions(orgId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId).queryKey,
      }),
    ]);
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ selectedId }: { selectedId: string }) => {
      await updateAndroidBuildCredentials(buildCredentialsId, {
        androidUploadKeystoreId: selectedId,
      });
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
      title="Change upload keystore"
      description="Pick a saved keystore in this organization."
      initialSelectedId={initialSelectedId}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading saved keystores…</p>}
        >
          <ChooseSavedTab
            orgId={orgId}
            currentId={currentKeystoreId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
    />
  );
};
