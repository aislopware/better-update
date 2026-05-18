import {
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  createAndroidBuildCredentials,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Checkbox } from "@better-update/ui/components/ui/checkbox";
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
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Suspense, useState } from "react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const NONE_VALUE = "__none__";

interface SelectableItem {
  readonly id: string;
  readonly label: string;
}

const ExistingPicker = ({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  items: readonly SelectableItem[];
  onChange: (next: string) => void;
}) => (
  <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(typeof next === "string" ? next : NONE_VALUE);
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  </Field>
);

const buildCreateBody = (params: {
  name: string;
  keystoreId: string;
  playSaId: string;
  fcmSaId: string;
  isDefault: boolean;
}) => ({
  name: params.name,
  isDefault: params.isDefault,
  ...(params.keystoreId === NONE_VALUE ? {} : { androidUploadKeystoreId: params.keystoreId }),
  ...(params.playSaId === NONE_VALUE
    ? {}
    : { googleServiceAccountKeyForSubmissionsId: params.playSaId }),
  ...(params.fcmSaId === NONE_VALUE ? {} : { googleServiceAccountKeyForFcmV1Id: params.fcmSaId }),
});

const AddGroupForm = ({
  orgId,
  applicationIdentifierId,
  onSuccess,
}: {
  orgId: string;
  applicationIdentifierId: string;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const { data: keystoreData } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));
  const { data: saData } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  const [name, setName] = useState("");
  const [keystoreId, setKeystoreId] = useState<string>(NONE_VALUE);
  const [playSaId, setPlaySaId] = useState<string>(NONE_VALUE);
  const [fcmSaId, setFcmSaId] = useState<string>(NONE_VALUE);
  const [isDefault, setIsDefault] = useState(false);

  const keystoreItems: readonly SelectableItem[] = keystoreData.items.map((item) => ({
    id: item.id,
    label: item.keyAlias,
  }));
  const saItems: readonly SelectableItem[] = saData.items.map((item) => ({
    id: item.id,
    label: item.clientEmail,
  }));

  const trimmedName = name.trim();

  const mutation = useApiMutation({
    mutationFn: async () =>
      createAndroidBuildCredentials(
        applicationIdentifierId,
        buildCreateBody({ name: trimmedName, keystoreId, playSaId, fcmSaId, isDefault }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId).queryKey,
      });
      toastManager.add({
        title: `Credential group "${trimmedName}" created`,
        type: "success",
      });
      onSuccess();
    },
  });

  const canSubmit = trimmedName.length > 0;

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        if (canSubmit) {
          await safeSubmit(mutation.mutateAsync());
        }
      }}
    >
      <DialogPanel>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="add-android-group-name">Name</FieldLabel>
            <Input
              id="add-android-group-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="default, preview, internal..."
              maxLength={120}
            />
          </Field>
          <ExistingPicker
            id="add-android-group-keystore"
            label="Upload keystore (optional)"
            value={keystoreId}
            items={keystoreItems}
            onChange={setKeystoreId}
          />
          <ExistingPicker
            id="add-android-group-play-sa"
            label="Play submissions SA (optional)"
            value={playSaId}
            items={saItems}
            onChange={setPlaySaId}
          />
          <ExistingPicker
            id="add-android-group-fcm-sa"
            label="FCM SA (optional)"
            value={fcmSaId}
            items={saItems}
            onChange={setFcmSaId}
          />
          <Label className="cursor-pointer gap-2 text-sm select-none">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(next) => {
                setIsDefault(next);
              }}
            />
            Set as default for this app identifier
          </Label>
        </FieldGroup>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!canSubmit} loading={mutation.isPending}>
          Create group
        </Button>
      </DialogFooter>
    </form>
  );
};

export const AddAndroidCredentialGroupDialog = ({
  orgId,
  applicationIdentifierId,
}: {
  orgId: string;
  applicationIdentifierId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add credential group
      </Button>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Android credential group</DialogTitle>
          <DialogDescription>
            Bind a name and an optional keystore + service accounts. The CLI selects a group by
            build profile name during build.
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <DialogPanel>
              <p className="text-muted-foreground text-sm">Loading credentials…</p>
            </DialogPanel>
          }
        >
          <AddGroupForm
            key={resetKey}
            orgId={orgId}
            applicationIdentifierId={applicationIdentifierId}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        </Suspense>
      </DialogPopup>
    </Dialog>
  );
};
