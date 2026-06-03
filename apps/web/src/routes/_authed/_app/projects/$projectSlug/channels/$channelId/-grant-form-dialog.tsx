import { Button } from "@better-update/ui/components/ui/button";
import { Checkbox } from "@better-update/ui/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, PencilIcon } from "lucide-react";

import type { ChannelGrant } from "@better-update/api";

import { getFieldError } from "../../../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../../../lib/use-api-mutation";
import { channelGrantsQueryKey, upsertChannelGrant } from "../../../../../../../queries/org";

import type { MemberItem } from "../../../../../../../queries/org";

// ── Action catalog ────────────────────────────────────────────────────────────
// Tokens are "resource:action" strings. Keep aligned with spec §9g validation.

const ACTION_CATALOG: Record<string, readonly string[]> = {
  channel: ["read", "create", "update", "delete"],
  update: ["read", "create", "delete"],
  rollout: ["read", "create", "update"],
  branch: ["read", "create", "update", "delete"],
  build: ["read", "create", "delete"],
  envVar: ["read", "create", "update", "delete"],
} as const;

// ── Form values ───────────────────────────────────────────────────────────────

interface GrantFormValues {
  memberId: string;
  effect: "allow" | "deny";
  actions: string[];
}

const buildInitialValues = (grant?: ChannelGrant): GrantFormValues => ({
  memberId: grant ? grant.memberId : "",
  effect: grant ? grant.effect : "allow",
  actions: grant ? [...grant.actions] : [],
});

// ── Action token checkboxes ───────────────────────────────────────────────────

const ActionTokenRow = ({
  resource,
  actions,
  selectedTokens,
  onToggle,
}: {
  resource: string;
  actions: readonly string[];
  selectedTokens: readonly string[];
  onToggle: (token: string, next: boolean) => void;
}) => (
  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
    <span className="w-24 shrink-0 text-sm font-medium capitalize">{resource}</span>
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => {
        const token = `${resource}:${action}`;
        const isChecked = selectedTokens.includes(token);
        return (
          <label
            key={token}
            className="flex cursor-pointer items-center gap-1.5 text-sm select-none"
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={(next) => {
                onToggle(token, next);
              }}
            />
            <span className="capitalize">{action}</span>
          </label>
        );
      })}
    </div>
  </div>
);

// ── Inner form (keyed by resetKey) ────────────────────────────────────────────

interface GrantFormInnerProps {
  channelId: string;
  grant?: ChannelGrant | undefined;
  members: readonly MemberItem[];
  onSuccess: () => void;
}

const GrantFormInner = ({ channelId, grant, members, onSuccess }: GrantFormInnerProps) => {
  const queryClient = useQueryClient();
  const isEdit = Boolean(grant);

  const mutation = useApiMutation({
    mutationFn: async (values: GrantFormValues) =>
      upsertChannelGrant(channelId, values.memberId, {
        effect: values.effect,
        actions: values.actions,
      }),
    onSuccess: async () => {
      toastManager.add({
        title: isEdit ? "Grant updated" : "Grant created",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: channelGrantsQueryKey(channelId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: buildInitialValues(grant),
    onSubmit: async ({ value }) => {
      await safeSubmit(mutation.mutateAsync(value));
    },
  });

  const memberLabels: Record<string, string> = Object.fromEntries(
    members.map((member) => {
      const label = member.user.name || member.user.email || member.id;
      return [member.id, label];
    }),
  );

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <DialogPanel className="max-h-[60vh] overflow-y-auto">
        <FieldGroup>
          {/* Member selector — only shown for create */}
          {isEdit ? null : (
            <form.Field
              name="memberId"
              validators={{
                onChange: ({ value }) => (value ? undefined : "Please select a member"),
              }}
            >
              {(field) => {
                const errorMessage = getFieldError(field);
                return (
                  <Field invalid={Boolean(errorMessage)}>
                    <FieldLabel>Member</FieldLabel>
                    <Select
                      items={memberLabels}
                      value={field.state.value}
                      onValueChange={(next) => {
                        if (next !== null) {
                          field.handleChange(next);
                        }
                      }}
                    >
                      <SelectTrigger aria-invalid={errorMessage ? true : undefined}>
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectGroup>
                          {members.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.user.name || member.user.email || member.id}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectPopup>
                    </Select>
                    <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>
          )}

          {/* Effect selector */}
          <form.Field name="effect">
            {(field) => (
              <Field>
                <FieldLabel>Effect</FieldLabel>
                <Select
                  items={{ allow: "Allow", deny: "Deny" }}
                  value={field.state.value}
                  onValueChange={(next) => {
                    if (next === "allow" || next === "deny") {
                      field.handleChange(next);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectGroup>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="deny">Deny</SelectItem>
                    </SelectGroup>
                  </SelectPopup>
                </Select>
              </Field>
            )}
          </form.Field>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <form.Field
              name="actions"
              validators={{
                onChange: ({ value }) =>
                  value.length > 0 ? undefined : "Select at least one action",
              }}
            >
              {(field) => {
                const errorMessage = getFieldError(field);
                return (
                  <Field invalid={Boolean(errorMessage)}>
                    <FieldLabel>Actions</FieldLabel>
                    <div className="flex flex-col divide-y rounded-md border p-3">
                      {Object.entries(ACTION_CATALOG).map(([resource, actions]) => (
                        <div key={resource} className="py-2.5 first:pt-0 last:pb-0">
                          <ActionTokenRow
                            resource={resource}
                            actions={actions}
                            selectedTokens={field.state.value}
                            onToggle={(token, next) => {
                              const updated = next
                                ? [...field.state.value, token]
                                : field.state.value.filter(
                                    (existingToken) => existingToken !== token,
                                  );
                              field.handleChange(updated);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>
          </div>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
              {isEdit ? (
                <>
                  <PencilIcon strokeWidth={2} data-icon="inline-start" />
                  Save grant
                </>
              ) : (
                <>
                  <PlusIcon strokeWidth={2} data-icon="inline-start" />
                  Add grant
                </>
              )}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

// ── Public component ──────────────────────────────────────────────────────────

interface GrantFormDialogProps {
  channelId: string;
  grant?: ChannelGrant | undefined;
  members: readonly MemberItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
  resetKey: number;
}

export const GrantFormDialog = ({
  channelId,
  grant,
  members,
  open,
  onOpenChange,
  onOpenChangeComplete,
  resetKey,
}: GrantFormDialogProps) => {
  const isEdit = Boolean(grant);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogPopup data-slot="dialog-popup">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit grant" : "Add grant"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the effect and action set for this member on this channel."
              : "Grant or deny specific actions for a member on this channel."}
          </DialogDescription>
        </DialogHeader>
        <GrantFormInner
          key={resetKey}
          channelId={channelId}
          grant={grant}
          members={members}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
