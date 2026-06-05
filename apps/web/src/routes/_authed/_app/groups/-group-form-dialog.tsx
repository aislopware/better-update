import {
  createGroup,
  groupQueryKey,
  groupsQueryKey,
  updateGroup,
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
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { GroupItem } from "@better-update/api-client/react";

import { toInputValue } from "../../../../lib/form-utils";
import { useApiMutation } from "../../../../lib/use-api-mutation";

const GroupForm = ({
  orgId,
  group,
  onSuccess,
}: {
  orgId: string;
  group: GroupItem | undefined;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(toInputValue(group?.name));
  const [description, setDescription] = useState(toInputValue(group?.description));
  const [submitted, setSubmitted] = useState(false);

  const trimmedName = name.trim();
  const nameError = trimmedName.length === 0 ? "Name is required." : null;

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const trimmedDescription = description.trim();
      if (group) {
        return updateGroup(group.id, {
          name: trimmedName,
          description: trimmedDescription.length > 0 ? trimmedDescription : null,
        });
      }
      return createGroup({
        name: trimmedName,
        ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: group ? "Group updated" : "Group created", type: "success" });
      await queryClient.invalidateQueries({ queryKey: groupsQueryKey(orgId) });
      if (group) {
        await queryClient.invalidateQueries({ queryKey: groupQueryKey(orgId, group.id) });
      }
      onSuccess();
    },
  });

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSubmitted(true);
        if (nameError !== null) {
          return;
        }
        saveMutation.mutate();
      }}
    >
      <DialogPanel className="grid gap-4">
        <Field invalid={submitted && nameError !== null}>
          <FieldLabel htmlFor="group-name">Name</FieldLabel>
          <Input
            id="group-name"
            placeholder="Release managers"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <FieldError match={submitted && nameError !== null}>{nameError}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="group-description">Description (optional)</FieldLabel>
          <Textarea
            id="group-description"
            placeholder="Who belongs to this group and why."
            rows={2}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" loading={saveMutation.isPending}>
          {group ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const GroupFormDialog = ({
  orgId,
  group,
  open,
  onOpenChange,
}: {
  orgId: string;
  group?: GroupItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "Create group"}</DialogTitle>
          <DialogDescription>
            Groups collect members so policies attached to the group apply to everyone in it.
          </DialogDescription>
        </DialogHeader>
        <GroupForm
          key={resetKey}
          orgId={orgId}
          group={group}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
