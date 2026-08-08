import {
  createEnvironment,
  deleteEnvironment,
  environmentsQueryKey,
  environmentsQueryOptions,
  renameEnvironment,
  setEnvironmentProtection,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { InputGroup } from "@better-update/ui/components/input-group";
import { Switch } from "@better-update/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { toast } from "@better-update/ui/components/toast";
import { MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod/v4";

import type { EnvironmentItem } from "@better-update/api-client/react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "../../../../components/confirm-dialog";
import { TablePanelSkeleton } from "../../../../components/skeletons";
import { TablePanel } from "../../../../components/table-panel";
import {
  ROW_ACTION_DISCLOSURE,
  RowActionsMenu,
  useClientPagination,
} from "../../../../lib/data-table";
import { getFieldError } from "../../../../lib/form-utils";
import { RelativeTime } from "../../../../lib/relative-time";
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
            return (
              <Input
                label="Environment name"
                error={errorMessage}
                id="environment-name"
                placeholder="staging"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || Boolean(isSubmitting)}
              loading={Boolean(isSubmitting)}
            >
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
      {/* Secondary inside a panel header: primary belongs to the page's own
          action, and two competing primaries on one screen read as a choice. */}
      <DialogTrigger render={<Button variant="secondary" />}>
        <PlusIcon weight="bold" data-icon="inline-start" />
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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${environment.name}?`}
      description="This cannot be undone. The environment must have no environment variables bound to it."
      confirmLabel="Delete environment"
      isPending={deleteMutation.isPending}
      onConfirm={() => {
        deleteMutation.mutate();
      }}
    />
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
    // One menu, the way every other list in the dashboard carries its row's
    // verbs. Two bare icon buttons put a delete a stray click away from a
    // rename, and named neither — the labels only existed for screen readers.
    <div className="flex items-center justify-end">
      <RowActionsMenu label={`Actions for ${environment.name}`}>
        <DropdownMenu.Item
          icon={PencilSimpleIcon}
          onClick={() => {
            setRenameOpen(true);
          }}
        >
          Rename environment
        </DropdownMenu.Item>
        <DropdownMenu.Item
          variant="danger"
          icon={TrashIcon}
          onClick={() => {
            setDeleteOpen(true);
          }}
        >
          Delete environment
        </DropdownMenu.Item>
      </RowActionsMenu>
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

const EnvironmentRow = ({
  orgId,
  environment,
}: {
  orgId: string;
  environment: EnvironmentItem;
}) => (
  // Same disclosure every other list gives its row controls: at rest on a fine
  // pointer they are invisible, and the row reveals them on hover or focus.
  <TableRow className={ROW_ACTION_DISCLOSURE}>
    <TableCell>
      <div className="flex items-center gap-2 font-medium">
        {environment.name}
        {environment.isBuiltin ? (
          <Badge variant="outline" className="text-kumo-subtle">
            Built-in
          </Badge>
        ) : null}
      </div>
    </TableCell>
    <TableCell className="text-kumo-subtle">
      {/* Built-ins exist since the org was created; their seeded epoch timestamp is noise. */}
      {environment.isBuiltin ? "—" : <RelativeTime value={environment.createdAt} />}
    </TableCell>
    <TableCell>
      <ProtectionSwitch orgId={orgId} environment={environment} />
    </TableCell>
    <TableCell className="text-right">
      <EnvironmentRowActions orgId={orgId} environment={environment} />
    </TableCell>
  </TableRow>
);

const EnvironmentsPanel = ({
  orgId,
  items,
  actions,
  emptyMessage,
}: {
  orgId: string;
  items: readonly EnvironmentItem[];
  actions: ReactNode;
  /** Stands in for the rows when the filter matches nothing. */
  emptyMessage: string | undefined;
}) => {
  // The page survives a filter change rather than being reset by a remount: the
  // filter box lives in this panel's header, and remounting would pull focus out
  // of the field mid-word. The page clamps to the last one that exists, so a
  // narrowed list still lands on rows.
  const pagination = useClientPagination(items, "environment");
  return (
    <TablePanel
      title="Environments"
      description="The three built-ins are always available. Add your own to scope environment variables. Protected environments only accept writes from Maintainers and Admins."
      actions={actions}
      pagination={emptyMessage === undefined ? pagination : undefined}
    >
      {emptyMessage === undefined ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Protected</TableHead>
              <TableHead className="w-px text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((environment) => (
              <EnvironmentRow key={environment.name} orgId={orgId} environment={environment} />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">{emptyMessage}</p>
      )}
    </TablePanel>
  );
};

export const EnvironmentsManager = ({ orgId }: { orgId: string }) => {
  const { data, isLoading } = useQuery(environmentsQueryOptions(orgId));
  const [query, setQuery] = useState("");
  const items = data?.items ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((environment) =>
    environment.name.toLowerCase().includes(normalizedQuery),
  );

  // The filter rides in the panel header beside the create button, so the whole
  // section stays one object rather than a control floating above a frame.
  const actions = (
    <>
      {items.length > TABLE_FILTER_THRESHOLD ? (
        <InputGroup className="w-40 sm:w-56">
          <InputGroup.Input
            type="search"
            value={query}
            placeholder="Filter environments…"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <InputGroup.Addon>
            <MagnifyingGlassIcon />
          </InputGroup.Addon>
        </InputGroup>
      ) : null}
      <CreateEnvironmentDialog orgId={orgId} />
    </>
  );

  // An org always has its three built-ins, so an empty table here means the
  // answer has not arrived yet — and a frame with a header, no rows and a
  // "1-0 of 0" footer reads as a list that came back empty.
  if (isLoading || !data) {
    return <TablePanelSkeleton columns={4} rows={3} />;
  }

  return (
    <EnvironmentsPanel
      orgId={orgId}
      items={visibleItems}
      actions={actions}
      emptyMessage={
        visibleItems.length === 0 && normalizedQuery
          ? `No environments match \u201C${query.trim()}\u201D.`
          : undefined
      }
    />
  );
};
