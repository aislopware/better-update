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
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, PencilIcon } from "lucide-react";

import type { OrgRole, PermissionGrantSchema } from "@better-update/api";

import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { createOrgRole, orgRolesQueryKey, updateOrgRole } from "../../../../queries/org";

// ── Permission catalog ──────────────────────────────────────────────────────
// Mirrors the server's statement resource/action sets.

const PERMISSION_CATALOG: Record<string, readonly string[]> = {
  project: ["read", "create", "update", "delete"],
  channel: ["read", "create", "update", "delete"],
  branch: ["read", "create", "update", "delete"],
  update: ["read", "create", "delete"],
  rollout: ["read", "create", "update"],
  envVar: ["read", "create", "update", "delete"],
  build: ["read", "create", "delete"],
  submission: ["read", "create", "update", "delete"],
  device: ["read", "create", "update", "delete"],
  apiKey: ["read", "create", "delete"],
  webhook: ["read", "create", "update", "delete"],
  credentials: ["read", "create", "update", "delete"],
} as const;

// ── Type helpers ─────────────────────────────────────────────────────────────

type PermissionGrant = typeof PermissionGrantSchema.Type;

const grantsToRecord = (grants: readonly PermissionGrant[]): Record<string, readonly string[]> =>
  Object.fromEntries(grants.map((grant) => [grant.resource, [...grant.actions]]));

const recordToGrants = (record: Record<string, readonly string[]>): PermissionGrant[] =>
  Object.entries(record)
    .filter(([, actions]) => actions.length > 0)
    .map(([resource, actions]) => ({ resource, actions: [...actions] }));

// ── Form values ──────────────────────────────────────────────────────────────

interface RoleFormValues {
  name: string;
  permissionMap: Record<string, readonly string[]>;
}

const buildDefaultPermissionMap = (): Record<string, readonly string[]> =>
  Object.fromEntries(Object.keys(PERMISSION_CATALOG).map((resource) => [resource, []]));

const buildInitialValues = (role?: OrgRole): RoleFormValues => ({
  name: role ? role.role : "",
  permissionMap: role
    ? { ...buildDefaultPermissionMap(), ...grantsToRecord(role.permissions) }
    : buildDefaultPermissionMap(),
});

// ── Resource action row ──────────────────────────────────────────────────────

const ResourceRow = ({
  resource,
  actions,
  checked,
  onToggle,
}: {
  resource: string;
  actions: readonly string[];
  checked: readonly string[];
  onToggle: (action: string, next: boolean) => void;
}) => (
  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
    <span className="w-28 shrink-0 text-sm font-medium capitalize">{resource}</span>
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => {
        const isChecked = checked.includes(action);
        return (
          <label
            key={action}
            className="flex cursor-pointer items-center gap-1.5 text-sm select-none"
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={(next) => {
                onToggle(action, next);
              }}
            />
            <span className="capitalize">{action}</span>
          </label>
        );
      })}
    </div>
  </div>
);

// ── Inner form (keyed child — receives key bump from parent) ─────────────────

interface RoleFormInnerProps {
  orgId: string;
  role?: OrgRole | undefined;
  onSuccess: () => void;
}

const RoleFormInner = ({ orgId, role, onSuccess }: RoleFormInnerProps) => {
  const queryClient = useQueryClient();
  const isEdit = Boolean(role);

  const mutation = useApiMutation({
    mutationFn: async (values: RoleFormValues) => {
      const permissions = recordToGrants(values.permissionMap);
      if (isEdit && role) {
        return updateOrgRole(role.id, { name: values.name, permissions });
      }
      return createOrgRole({ name: values.name, permissions });
    },
    onSuccess: async () => {
      toastManager.add({
        title: isEdit ? "Role updated" : "Role created",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: orgRolesQueryKey(orgId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: buildInitialValues(role),
    onSubmit: async ({ value }) => {
      await safeSubmit(mutation.mutateAsync(value));
    },
  });

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
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) => {
                const result = requiredStringSchema.safeParse(value.trim());
                return result.success ? undefined : "Role name is required";
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="role-name">Role name</FieldLabel>
                  <Input
                    id="role-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    placeholder="e.g. releaser, reviewer"
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                </Field>
              );
            }}
          </form.Field>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Permissions</span>
            <div className="flex flex-col divide-y">
              {Object.entries(PERMISSION_CATALOG).map(([resource, actions]) => (
                <div key={resource} className="py-3 first:pt-0 last:pb-0">
                  <form.Field name="permissionMap">
                    {(field) => (
                      <ResourceRow
                        resource={resource}
                        actions={actions}
                        checked={field.state.value[resource] ?? []}
                        onToggle={(action, next) => {
                          const current = field.state.value[resource] ?? [];
                          const updated = next
                            ? [...current, action]
                            : current.filter((existingAction) => existingAction !== action);
                          field.handleChange({
                            ...field.state.value,
                            [resource]: updated,
                          });
                        }}
                      />
                    )}
                  </form.Field>
                </div>
              ))}
            </div>
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
                  Save changes
                </>
              ) : (
                <>
                  <PlusIcon strokeWidth={2} data-icon="inline-start" />
                  Create role
                </>
              )}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

// ── Public dialog component ─────────────────────────────────────────────────

interface RoleFormDialogProps {
  orgId: string;
  role?: OrgRole | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
  resetKey: number;
}

export const RoleFormDialog = ({
  orgId,
  role,
  open,
  onOpenChange,
  onOpenChangeComplete,
  resetKey,
}: RoleFormDialogProps) => {
  const isEdit = Boolean(role);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogPopup data-slot="dialog-popup">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit role" : "Create role"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the role name and its permission set."
              : "Define a new custom role with a specific set of resource permissions."}
          </DialogDescription>
        </DialogHeader>
        <RoleFormInner
          key={resetKey}
          orgId={orgId}
          role={role}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
