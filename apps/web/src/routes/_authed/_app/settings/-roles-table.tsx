import { toOptional } from "@better-update/type-guards";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
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
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { EllipsisVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { OrgRole } from "@better-update/api";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { DataTableView } from "../../../../lib/data-table";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { deleteOrgRole, orgRolesQueryKey } from "../../../../queries/org";
import { RoleFormDialog } from "./-role-form-dialog";

// ── Delete confirm dialog ─────────────────────────────────────────────────

const DeleteRoleDialog = ({
  orgId,
  role,
  open,
  onOpenChange,
  onOpenChangeComplete,
  resetKey,
}: {
  orgId: string;
  role: OrgRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
  resetKey: number;
}) => {
  const queryClient = useQueryClient();

  const deleteMutation = useApiMutation({
    mutationFn: async (id: string) => deleteOrgRole(id),
    onSuccess: async () => {
      toastManager.add({ title: "Role deleted", type: "success" });
      await queryClient.invalidateQueries({ queryKey: orgRolesQueryKey(orgId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogPopup data-slot="dialog-popup">
        <DialogHeader>
          <DialogTitle>Delete role &ldquo;{role?.role}&rdquo;?</DialogTitle>
          <DialogDescription>
            This will permanently remove the role. Members assigned this role will lose its
            permissions.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel key={resetKey} />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              if (role) {
                deleteMutation.mutate(role.id);
              }
            }}
          >
            <Trash2Icon strokeWidth={2} data-icon="inline-start" />
            Delete role
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

// ── Row actions ──────────────────────────────────────────────────────────────

const RoleRowActions = ({
  role,
  onEdit,
  onDelete,
}: {
  role: OrgRole;
  onEdit: (role: OrgRole) => void;
  onDelete: (role: OrgRole) => void;
}) => (
  <Menu>
    <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="Role actions" />}>
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuGroup>
        <MenuItem
          onClick={() => {
            onEdit(role);
          }}
        >
          <PencilIcon strokeWidth={2} />
          <span>Edit</span>
        </MenuItem>
        <MenuItem
          variant="destructive"
          onClick={() => {
            onDelete(role);
          }}
        >
          <Trash2Icon strokeWidth={2} />
          <span>Delete</span>
        </MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

// ── Permission summary chip ───────────────────────────────────────────────────

const PermissionSummary = ({ role }: { role: OrgRole }) => {
  const total = role.permissions.reduce((sum, grant) => sum + grant.actions.length, 0);
  if (total === 0) {
    return <span className="text-muted-foreground text-sm">No permissions</span>;
  }
  return (
    <Badge variant="secondary">
      {total} {total === 1 ? "permission" : "permissions"}
    </Badge>
  );
};

// ── Table ─────────────────────────────────────────────────────────────────────

interface BuildColumnsParams {
  onEdit: (role: OrgRole) => void;
  onDelete: (role: OrgRole) => void;
}

const buildColumns = ({ onEdit, onDelete }: BuildColumnsParams): ColumnDef<OrgRole>[] => [
  {
    id: "name",
    accessorFn: (row) => row.role,
    header: "Name",
    cell: ({ row }) => <span className="font-medium capitalize">{row.original.role}</span>,
    enableSorting: true,
  },
  {
    id: "permissions",
    accessorFn: (row) => row.permissions.reduce((sum, grant) => sum + grant.actions.length, 0),
    header: "Permissions",
    cell: ({ row }) => <PermissionSummary role={row.original} />,
    enableSorting: true,
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RoleRowActions role={row.original} onEdit={onEdit} onDelete={onDelete} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];

export const RolesTableView = ({
  orgId,
  roles,
  countLabel,
  sorting,
  onSortingChange,
}: {
  orgId: string;
  roles: readonly OrgRole[];
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
}) => {
  const [editRole, setEditRole] = useState<OrgRole | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editResetKey, setEditResetKey] = useState(0);

  const [deleteRole, setDeleteRole] = useState<OrgRole | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteResetKey, setDeleteResetKey] = useState(0);

  const handleEdit = useCallback((role: OrgRole) => {
    setEditRole(role);
    setEditOpen(true);
  }, []);

  const handleDelete = useCallback((role: OrgRole) => {
    setDeleteRole(role);
    setDeleteOpen(true);
  }, []);

  const columns = useMemo(
    () => buildColumns({ onEdit: handleEdit, onDelete: handleDelete }),
    [handleEdit, handleDelete],
  );

  const tableData = useMemo(() => [...roles], [roles]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <DataTableView table={table} columnsCount={columns.length} countLabel={countLabel} />

      <RoleFormDialog
        orgId={orgId}
        role={toOptional(editRole)}
        open={editOpen}
        onOpenChange={setEditOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setEditResetKey((prev) => prev + 1);
            setEditRole(null);
          }
        }}
        resetKey={editResetKey}
      />

      <DeleteRoleDialog
        orgId={orgId}
        role={deleteRole}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setDeleteResetKey((prev) => prev + 1);
            setDeleteRole(null);
          }
        }}
        resetKey={deleteResetKey}
      />
    </>
  );
};
