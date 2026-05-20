import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
  uploadApplePushKey,
} from "@better-update/api-client/react";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type { ApplePushKeyItem } from "@better-update/api-client/react";

import { formatAppleTeamLabel, safeReadFileAsText } from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

import type { ChangeCredentialTab } from "./-change-credential-dialog";

interface ChooseSavedTabProps {
  readonly orgId: string;
  readonly appleTeamId: string;
  readonly currentId: string | null;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const ChooseSavedTab = ({
  orgId,
  appleTeamId,
  currentId,
  selectedId,
  onSelect,
}: ChooseSavedTabProps) => {
  const { data: keys } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamMap = new Map(teams.items.map((team) => [team.id, team]));
  const filtered = keys.items.filter((key) => key.appleTeamId === appleTeamId);

  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved push keys for this Apple Team. Switch to “Upload new” to add one.
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
        {filtered.map((key) => {
          const team = teamMap.get(key.appleTeamId);
          const isCurrent = key.id === currentId;
          return (
            <label
              key={key.id}
              htmlFor={`push-${key.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`push-${key.id}`} value={key.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{key.keyId}</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {team ? formatAppleTeamLabel(team) : key.appleTeamId} · added{" "}
                  {formatDate(key.createdAt)}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface UploadFormState {
  readonly keyId: string;
  readonly p8Pem: string;
  readonly appleTeamIdentifier: string;
}

const UPLOAD_INITIAL: UploadFormState = {
  keyId: "",
  p8Pem: "",
  appleTeamIdentifier: "",
};

const isUploadValid = (state: UploadFormState) =>
  /^[A-Z0-9]{10}$/u.test(state.keyId) &&
  state.p8Pem.includes("BEGIN PRIVATE KEY") &&
  /^[A-Z0-9]{10}$/u.test(state.appleTeamIdentifier);

interface UploadTabProps {
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ state, onChange }: UploadTabProps) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="change-push-key-id">Key ID</FieldLabel>
      <Input
        id="change-push-key-id"
        placeholder="ABCDE12345"
        value={state.keyId}
        onChange={(event) => {
          onChange({ ...state, keyId: event.target.value.toUpperCase() });
        }}
      />
      <FieldError match={state.keyId.length > 0 && !/^[A-Z0-9]{10}$/u.test(state.keyId)}>
        10 uppercase alphanumeric
      </FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-push-team">Apple Team ID</FieldLabel>
      <Input
        id="change-push-team"
        placeholder="ABCDE12345"
        value={state.appleTeamIdentifier}
        onChange={(event) => {
          onChange({ ...state, appleTeamIdentifier: event.target.value.toUpperCase() });
        }}
      />
      <FieldError
        match={
          state.appleTeamIdentifier.length > 0 && !/^[A-Z0-9]{10}$/u.test(state.appleTeamIdentifier)
        }
      >
        10 uppercase alphanumeric
      </FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-push-file">.p8 file</FieldLabel>
      <Input
        id="change-push-file"
        type="file"
        accept=".p8,text/plain"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file === undefined) {
            return;
          }
          const value = await safeReadFileAsText(file);
          if (value === null) {
            toastManager.add({ title: "Failed to read file", type: "error" });
            return;
          }
          onChange({ ...state, p8Pem: value });
        }}
      />
      <Textarea
        readOnly
        value={state.p8Pem}
        rows={3}
        className="mt-2 font-mono text-xs"
        placeholder="PEM content will appear here after file selection"
      />
    </Field>
  </div>
);

interface IosChangePushKeyDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly configIds: readonly string[];
  readonly appleTeamId: string;
  readonly currentKey: ApplePushKeyItem | null;
}

export const IosChangePushKeyDialog = ({
  open,
  onOpenChange,
  orgId,
  projectId,
  configIds,
  appleTeamId,
  currentKey,
}: IosChangePushKeyDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentKey === null ? "" : currentKey.id;
  const currentKeyId: string | null = currentKey === null ? null : currentKey.id;
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: applePushKeysQueryOptions(orgId).queryKey }),
      queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  const resolveKeyId = async (tab: ChangeCredentialTab, selectedId: string): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const uploaded = await uploadApplePushKey({
      keyId: uploadState.keyId,
      p8Pem: uploadState.p8Pem,
      appleTeamIdentifier: uploadState.appleTeamIdentifier,
    });
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ tab, selectedId }: { tab: ChangeCredentialTab; selectedId: string }) => {
      const keyId = await resolveKeyId(tab, selectedId);
      await Promise.all(
        configIds.map(async (id) => updateIosBundleConfiguration(id, { applePushKeyId: keyId })),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "Push key updated", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <ChangeCredentialDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change push key"
      description="Upload a new .p8 APNs key or pick a saved key on this Apple Team. The new binding applies to every distribution type for this bundle identifier."
      initialSelectedId={initialSelectedId}
      isUploadValid={isUploadValid(uploadState)}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      onResetUpload={() => {
        setUploadState(UPLOAD_INITIAL);
      }}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading saved keys…</p>}>
          <ChooseSavedTab
            orgId={orgId}
            appleTeamId={appleTeamId}
            currentId={currentKeyId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
      renderUpload={() => <UploadTab state={uploadState} onChange={setUploadState} />}
    />
  );
};
