import {
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
  uploadAscApiKey,
} from "@better-update/api-client/react";
import { compact } from "@better-update/type-guards";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { Tabs, TabsList, TabsTab } from "@better-update/ui/components/ui/tabs";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type { AscApiKeyItem } from "@better-update/api-client/react";

import { formatAppleTeamLabel, safeReadFileAsText } from "../../-credentials-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const UUID_PATTERN =
  /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/u;

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
  const { data: keys } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamMap = new Map(teams.items.map((team) => [team.id, team]));
  const filtered = keys.items.filter((key) => key.appleTeamId === appleTeamId);

  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved ASC API keys for this Apple Team. Switch to “Upload new” to add one.
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
          const team = key.appleTeamId === null ? null : teamMap.get(key.appleTeamId);
          const isCurrent = key.id === currentId;
          return (
            <label
              key={key.id}
              htmlFor={`asc-${key.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`asc-${key.id}`} value={key.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{key.name}</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {key.keyId}
                  {team ? ` · ${formatAppleTeamLabel(team)}` : ""}
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
  readonly name: string;
  readonly keyId: string;
  readonly issuerId: string;
  readonly p8Pem: string;
  readonly appleTeamIdentifier: string;
}

const UPLOAD_INITIAL: UploadFormState = {
  name: "",
  keyId: "",
  issuerId: "",
  p8Pem: "",
  appleTeamIdentifier: "",
};

const isUploadValid = (state: UploadFormState) =>
  state.name.length > 0 &&
  /^[A-Z0-9]{10}$/u.test(state.keyId) &&
  UUID_PATTERN.test(state.issuerId) &&
  state.p8Pem.includes("BEGIN PRIVATE KEY");

interface UploadTabProps {
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ state, onChange }: UploadTabProps) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="change-asc-name">Label</FieldLabel>
      <Input
        id="change-asc-name"
        placeholder="Primary ASC key"
        value={state.name}
        onChange={(event) => {
          onChange({ ...state, name: event.target.value });
        }}
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="change-asc-key-id">Key ID</FieldLabel>
        <Input
          id="change-asc-key-id"
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
        <FieldLabel htmlFor="change-asc-team">Apple Team ID (optional)</FieldLabel>
        <Input
          id="change-asc-team"
          placeholder="ABCDE12345"
          value={state.appleTeamIdentifier}
          onChange={(event) => {
            onChange({ ...state, appleTeamIdentifier: event.target.value.toUpperCase() });
          }}
        />
      </Field>
    </div>
    <Field>
      <FieldLabel htmlFor="change-asc-issuer">Issuer ID</FieldLabel>
      <Input
        id="change-asc-issuer"
        placeholder="12345678-abcd-ef12-3456-7890abcdef12"
        value={state.issuerId}
        onChange={(event) => {
          onChange({ ...state, issuerId: event.target.value });
        }}
      />
      <FieldError match={state.issuerId.length > 0 && !UUID_PATTERN.test(state.issuerId)}>
        Must be a UUID
      </FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-asc-file">.p8 file</FieldLabel>
      <Input
        id="change-asc-file"
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

interface IosChangeAscKeyDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly configIds: readonly string[];
  readonly appleTeamId: string;
  readonly currentKey: AscApiKeyItem | null;
}

type TabValue = "saved" | "upload";

export const IosChangeAscKeyDialog = ({
  open,
  onOpenChange,
  orgId,
  projectId,
  configIds,
  appleTeamId,
  currentKey,
}: IosChangeAscKeyDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentKey === null ? "" : currentKey.id;
  const currentKeyId: string | null = currentKey === null ? null : currentKey.id;
  const [tab, setTab] = useState<TabValue>("saved");
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ascApiKeysQueryOptions(orgId).queryKey }),
      queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  const resolveKeyId = async (): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const payload = {
      name: uploadState.name,
      keyId: uploadState.keyId,
      issuerId: uploadState.issuerId,
      p8Pem: uploadState.p8Pem,
      ...compact({ appleTeamIdentifier: uploadState.appleTeamIdentifier || undefined }),
    };
    const uploaded = await uploadAscApiKey(payload);
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const keyId = await resolveKeyId();
      await Promise.all(
        configIds.map(async (id) => updateIosBundleConfiguration(id, { ascApiKeyId: keyId })),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "ASC API key updated", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  const canSubmit = tab === "upload" ? isUploadValid(uploadState) : selectedId.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setTab("saved");
          setSelectedId(initialSelectedId);
          setUploadState(UPLOAD_INITIAL);
        }
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change App Store Connect API key</DialogTitle>
          <DialogDescription>
            Upload a new .p8 ASC key or pick a saved key on this Apple Team. The new binding applies
            to every distribution type for this bundle identifier.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value === "upload" ? "upload" : "saved");
            }}
            className="mb-4"
          >
            <TabsList>
              <TabsTab value="saved">Choose saved</TabsTab>
              <TabsTab value="upload">Upload new</TabsTab>
            </TabsList>
          </Tabs>
          {tab === "saved" ? (
            <Suspense
              fallback={<p className="text-muted-foreground text-sm">Loading saved keys…</p>}
            >
              <ChooseSavedTab
                orgId={orgId}
                appleTeamId={appleTeamId}
                currentId={currentKeyId}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </Suspense>
          ) : (
            <UploadTab state={uploadState} onChange={setUploadState} />
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canSubmit}
            loading={saveMutation.isPending}
            onClick={async () => {
              await safeSubmit(saveMutation.mutateAsync(undefined));
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
