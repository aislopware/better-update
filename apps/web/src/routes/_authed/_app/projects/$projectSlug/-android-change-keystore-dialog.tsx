import {
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  updateAndroidBuildCredentials,
  uploadAndroidUploadKeystore,
} from "@better-update/api-client/react";
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
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type { AndroidUploadKeystoreItem } from "@better-update/api-client/react";

import { safeReadFileAsBase64 } from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

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
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved keystores yet. Switch to “Upload new” to add one.
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

interface UploadFormState {
  readonly keystoreBase64: string;
  readonly keyAlias: string;
  readonly keystorePassword: string;
  readonly keyPassword: string;
}

const UPLOAD_INITIAL: UploadFormState = {
  keystoreBase64: "",
  keyAlias: "",
  keystorePassword: "",
  keyPassword: "",
};

const isUploadValid = (state: UploadFormState) =>
  state.keystoreBase64.length > 0 &&
  state.keyAlias.length > 0 &&
  state.keystorePassword.length > 0 &&
  state.keyPassword.length > 0;

interface UploadTabProps {
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ state, onChange }: UploadTabProps) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="change-keystore-file">Keystore (.jks / .keystore)</FieldLabel>
      <Input
        id="change-keystore-file"
        type="file"
        accept=".jks,.keystore,application/octet-stream"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file === undefined) {
            return;
          }
          const value = await safeReadFileAsBase64(file);
          if (value === null) {
            toastManager.add({ title: "Failed to read file", type: "error" });
            return;
          }
          onChange({ ...state, keystoreBase64: value });
        }}
      />
      <FieldError match={state.keystoreBase64.length === 0}>Select a keystore file</FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-keystore-alias">Key alias</FieldLabel>
      <Input
        id="change-keystore-alias"
        placeholder="upload"
        value={state.keyAlias}
        onChange={(event) => {
          onChange({ ...state, keyAlias: event.target.value });
        }}
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="change-keystore-pw">Keystore password</FieldLabel>
        <Input
          id="change-keystore-pw"
          type="password"
          value={state.keystorePassword}
          onChange={(event) => {
            onChange({ ...state, keystorePassword: event.target.value });
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="change-key-pw">Key password</FieldLabel>
        <Input
          id="change-key-pw"
          type="password"
          value={state.keyPassword}
          onChange={(event) => {
            onChange({ ...state, keyPassword: event.target.value });
          }}
        />
      </Field>
    </div>
  </div>
);

interface AndroidChangeKeystoreDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly applicationIdentifierId: string;
  readonly buildCredentialsId: string;
  readonly currentKeystore: AndroidUploadKeystoreItem | null;
}

type TabValue = "saved" | "upload";

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
  const [tab, setTab] = useState<TabValue>("saved");
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

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

  const resolveKeystoreId = async (): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const uploaded = await uploadAndroidUploadKeystore({
      keystoreBase64: uploadState.keystoreBase64,
      keyAlias: uploadState.keyAlias,
      keystorePassword: uploadState.keystorePassword,
      keyPassword: uploadState.keyPassword,
    });
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const keystoreId = await resolveKeystoreId();
      await updateAndroidBuildCredentials(buildCredentialsId, {
        androidUploadKeystoreId: keystoreId,
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Upload keystore updated", type: "success" });
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
          <DialogTitle>Change upload keystore</DialogTitle>
          <DialogDescription>
            Upload a new keystore or pick a saved one in this organization.
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
              fallback={<p className="text-muted-foreground text-sm">Loading saved keystores…</p>}
            >
              <ChooseSavedTab
                orgId={orgId}
                currentId={currentKeystoreId}
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
