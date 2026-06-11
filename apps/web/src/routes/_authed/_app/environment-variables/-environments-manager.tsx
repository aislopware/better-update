import {
  createEnvironment,
  deleteEnvironment,
  environmentsQueryKey,
  environmentsQueryOptions,
  renameEnvironment,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Frame } from "@better-update/ui/components/ui/frame";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { z } from "zod/v4";

import type { EnvironmentItem } from "@better-update/api-client/react";

import { getFieldError } from "../../../../lib/form-utils";
import { formatShortDateTime } from "../../../../lib/format-date";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

const environmentNameSchema = z
  .string()
  .check(
    z.minLength(1, "Name is required"),
    z.maxLength(64, "Max 64 characters"),
    z.regex(
      /^[a-z][a-z0-9-]*$/u,
      "Lowercase letters, digits, and hyphens; must start with a letter",
    ),
  );

const EnvironmentNameForm = ({
  defaultName,
  submitLabel,
  onSubmit,
}: {
  defaultName: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) => {
  const form = useForm({
    defaultValues: { name: defaultName },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name);
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
      <DialogPanel>
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) => {
              const result = environmentNameSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="environment-name">Environment name</FieldLabel>
                <Input
                  id="environment-name"
                  placeholder="staging"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

const CreateEnvironmentDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const queryClient = useQueryClient();
  const createMutation = useApiMutation({
    mutationFn: async (name: string) => createEnvironment({ name }),
    onSuccess: async () => {
      toastManager.add({ title: "Environment created", type: "success" });
      await queryClient.invalidateQueries({ queryKey: environmentsQueryKey(orgId) });
      setOpen(false);
    },
  });

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
      <DialogTrigger render={<Button />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add environment
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add an environment</DialogTitle>
          <DialogDescription>
            Create a user-defined environment for environment variables across the organization.
          </DialogDescription>
        </DialogHeader>
        <EnvironmentNameForm
          key={resetKey}
          defaultName=""
          submitLabel="Create environment"
          onSubmit={async (name) => safeSubmit(createMutation.mutateAsync(name))}
        />
      </DialogPopup>
    </Dialog>
  );
};

const RenameEnvironmentDialog = ({
  orgId,
  environment,
  open,
  onOpenChange,
}: {
  orgId: string;
  environment: EnvironmentItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const [resetKey, setResetKey] = useState(0);
  const queryClient = useQueryClient();
  const renameMutation = useApiMutation({
    mutationFn: async (name: string) => renameEnvironment(environment.name, { name }),
    onSuccess: async () => {
      toastManager.add({ title: "Environment renamed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: environmentsQueryKey(orgId) });
      onOpenChange(false);
    },
  });

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
          <DialogTitle>Rename {environment.name}</DialogTitle>
          <DialogDescription>
            Environment variables bound to this environment are re-pointed to the new name.
          </DialogDescription>
        </DialogHeader>
        <EnvironmentNameForm
          key={resetKey}
          defaultName={environment.name}
          submitLabel="Rename environment"
          onSubmit={async (name) => safeSubmit(renameMutation.mutateAsync(name))}
        />
      </DialogPopup>
    </Dialog>
  );
};

const DeleteEnvironmentDialog = ({
  orgId,
  environment,
  open,
  onOpenChange,
}: {
  orgId: string;
  environment: EnvironmentItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const deleteMutation = useApiMutation({
    mutationFn: async () => deleteEnvironment(environment.name),
    onSuccess: async () => {
      toastManager.add({ title: "Environment deleted", type: "success" });
      await queryClient.invalidateQueries({ queryKey: environmentsQueryKey(orgId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Delete {environment.name}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. The environment must have no environment variables bound to it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            Delete environment
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

const EnvironmentRowActions = ({
  orgId,
  environment,
}: {
  orgId: string;
  environment: EnvironmentItem;
}) => {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (environment.isBuiltin) {
    return <Badge variant="secondary">Built-in</Badge>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Rename ${environment.name}`}
        onClick={() => {
          setRenameOpen(true);
        }}
      >
        <PencilIcon strokeWidth={2} className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Delete ${environment.name}`}
        onClick={() => {
          setDeleteOpen(true);
        }}
      >
        <Trash2Icon strokeWidth={2} className="text-destructive size-4" />
      </Button>
      <RenameEnvironmentDialog
        orgId={orgId}
        environment={environment}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteEnvironmentDialog
        orgId={orgId}
        environment={environment}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
};

export const EnvironmentsManager = ({ orgId }: { orgId: string }) => {
  const { data } = useQuery(environmentsQueryOptions(orgId));
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Environments</h2>
          <p className="text-muted-foreground text-sm">
            The three built-ins are always available. Add your own to scope environment variables.
          </p>
        </div>
        <CreateEnvironmentDialog orgId={orgId} />
      </div>
      <Frame>
        <Table variant="card">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((environment) => (
              <TableRow key={environment.name}>
                <TableCell className="font-medium">{environment.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatShortDateTime(environment.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <EnvironmentRowActions orgId={orgId} environment={environment} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
    </div>
  );
};
