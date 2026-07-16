import {
  createEnvironment,
  deleteEnvironment,
  environmentsQueryKey,
  environmentsQueryOptions,
  renameEnvironment,
  setEnvironmentProtection,
} from "@better-update/api-client/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@better-update/ui/components/ui/alert-dialog";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { Switch } from "@better-update/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { z } from "zod/v4";

import type { EnvironmentItem } from "@better-update/api-client/react";

import { SectionHeader } from "../../../../components/page-header";
import { ClientPaginationFooter, useClientPagination } from "../../../../lib/data-table";
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
      <FieldGroup>
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
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="environment-name">Environment name</FieldLabel>
                <Input
                  id="environment-name"
                  placeholder="staging"
                  aria-invalid={invalid || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {invalid ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
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
      toast.success("Environment created");
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
      <DialogContent>
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
      </DialogContent>
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
      toast.success("Environment renamed");
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
      <DialogContent>
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
      </DialogContent>
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
      toast.success("Environment deleted");
      await queryClient.invalidateQueries({ queryKey: environmentsQueryKey(orgId) });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {environment.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. The environment must have no environment variables bound to it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            Delete environment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// GitLab-protected-branches analogue (ROLES-CAPABILITIES-SPEC §2d): writes into
// a protected environment additionally require environment:update — Developers
// cannot publish/edit there; Maintainers, Admins, and explicit grants can.
const ProtectionSwitch = ({
  orgId,
  environment,
}: {
  orgId: string;
  environment: EnvironmentItem;
}) => {
  const queryClient = useQueryClient();
  const protectionMutation = useApiMutation({
    mutationFn: async (next: boolean) => setEnvironmentProtection(environment.name, next),
    onSuccess: async (_result, next) => {
      toast.success(next ? "Environment protected" : "Environment unprotected");
      await queryClient.invalidateQueries({ queryKey: environmentsQueryKey(orgId) });
    },
  });
  return (
    <Switch
      checked={environment.protected}
      disabled={protectionMutation.isPending}
      aria-label={`Protect ${environment.name}`}
      onCheckedChange={(next) => {
        protectionMutation.mutate(next);
      }}
    />
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
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground/70 hover:text-foreground"
        aria-label={`Rename ${environment.name}`}
        onClick={() => {
          setRenameOpen(true);
        }}
      >
        <PencilIcon strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground/70 hover:text-destructive"
        aria-label={`Delete ${environment.name}`}
        onClick={() => {
          setDeleteOpen(true);
        }}
      >
        <Trash2Icon strokeWidth={2} />
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

// Below this count the whole table is scannable at a glance — no filter box.
const TABLE_FILTER_THRESHOLD = 8;

const EnvironmentsTable = ({
  orgId,
  items,
}: {
  orgId: string;
  items: readonly EnvironmentItem[];
}) => {
  const pagination = useClientPagination(items, "environment");
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead>Protected</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((environment) => (
              <TableRow key={environment.name}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {environment.name}
                    {environment.isBuiltin ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Built-in
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {/* Built-ins exist since the org was created; their seeded epoch timestamp is noise. */}
                  {environment.isBuiltin ? "—" : formatShortDateTime(environment.createdAt)}
                </TableCell>
                <TableCell>
                  <ProtectionSwitch orgId={orgId} environment={environment} />
                </TableCell>
                <TableCell className="text-right">
                  <EnvironmentRowActions orgId={orgId} environment={environment} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ClientPaginationFooter state={pagination} />
    </div>
  );
};

export const EnvironmentsManager = ({ orgId }: { orgId: string }) => {
  const { data } = useQuery(environmentsQueryOptions(orgId));
  const [query, setQuery] = useState("");
  const items = data?.items ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((environment) =>
    environment.name.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        title="Environments"
        description="The three built-ins are always available. Add your own to scope environment variables. Protected environments only accept writes from Maintainers and Admins."
        actions={<CreateEnvironmentDialog orgId={orgId} />}
      />
      {items.length > TABLE_FILTER_THRESHOLD ? (
        <InputGroup className="w-full sm:w-56">
          <InputGroupInput
            type="search"
            value={query}
            placeholder="Filter environments…"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
      ) : null}
      {visibleItems.length === 0 && normalizedQuery ? (
        <p className="text-muted-foreground text-sm">No environments match “{query.trim()}”.</p>
      ) : (
        // Filter identity as key: a filter change remounts the table so client
        // pagination resets to page 1.
        <EnvironmentsTable key={normalizedQuery} orgId={orgId} items={visibleItems} />
      )}
    </div>
  );
};
