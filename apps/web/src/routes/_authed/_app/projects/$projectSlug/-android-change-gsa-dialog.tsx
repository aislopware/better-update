import {
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
  updateAndroidBuildCredentials,
  uploadGoogleServiceAccountKey,
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
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { safeReadFileAsText } from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const TITLE = "Change FCM v1 Service Account";
const DESCRIPTION =
  "Upload a new Firebase Admin SDK JSON or pick a saved service account. Applied across all credential groups for this app identifier.";

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
        No saved service accounts yet. Switch to “Upload new” to add one.
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

interface UploadFormState {
  readonly json: string;
}

const UPLOAD_INITIAL: UploadFormState = { json: "" };

const isJsonValid = (raw: string): boolean => {
  // eslint-disable-next-line functional/no-try-statements -- JSON.parse throws on invalid input, expressed here as a boolean
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "client_email" in parsed &&
      "private_key" in parsed
    );
  } catch {
    return false;
  }
};

interface UploadTabProps {
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ state, onChange }: UploadTabProps) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="change-gsa-file">Service account JSON</FieldLabel>
      <Input
        id="change-gsa-file"
        type="file"
        accept=".json,application/json"
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
          onChange({ ...state, json: value });
        }}
      />
      <Textarea
        readOnly
        value={state.json}
        rows={4}
        className="mt-2 font-mono text-xs"
        placeholder="JSON content will appear here after file selection"
      />
      <FieldError match={state.json.length > 0 && !isJsonValid(state.json)}>
        JSON must include client_email and private_key
      </FieldError>
    </Field>
  </div>
);

interface AndroidChangeGsaDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly applicationIdentifierId: string;
  readonly groupIds: readonly string[];
  readonly currentSa: GoogleServiceAccountKeyItem | null;
}

type TabValue = "saved" | "upload";

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
  const [tab, setTab] = useState<TabValue>("saved");
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

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

  const resolveSaId = async (): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const uploaded = await uploadGoogleServiceAccountKey({ json: uploadState.json });
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const saId = await resolveSaId();
      await Promise.all(
        groupIds.map(async (groupId) =>
          updateAndroidBuildCredentials(groupId, { googleServiceAccountKeyForFcmV1Id: saId }),
        ),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "FCM service account updated", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  const canSubmit = tab === "upload" ? isJsonValid(uploadState.json) : selectedId.length > 0;

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
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
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
              fallback={<p className="text-muted-foreground text-sm">Loading service accounts…</p>}
            >
              <ChooseSavedTab
                orgId={orgId}
                currentId={currentSaId}
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
