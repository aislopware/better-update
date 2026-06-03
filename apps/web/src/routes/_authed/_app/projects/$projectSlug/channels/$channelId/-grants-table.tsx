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

import type { ChannelGrant } from "@better-update/api";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { DataTableView } from "../../../../../../../lib/data-table";
import { useApiMutation } from "../../../../../../../lib/use-api-mutation";
import { channelGrantsQueryKey, deleteChannelGrant } from "../../../../../../../queries/org";
import { GrantFormDialog } from "./-grant-form-dialog";

import type { MemberItem } from "../../../../../../../queries/org";

// ── Effect badge ───────────────────────────────────────────────────────────────

const EffectBadge = ({ effect }: { effect: "allow" | "deny" }) =>
  effect === "allow" ? (
    <Badge variant="secondary" className="bg-success/16 text-success border-success/24">
      Allow
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-destructive/16 text-destructive border-destructive/24">
      Deny
    </Badge>
  );

// ── Action chips ───────────────────────────────────────────────────────────────

const ActionChips = ({ actions }: { actions: readonly string[] }) => (
  <div className="flex flex-wrap gap-1">
    {actions.map((token) => (
      <Badge key={token} variant="outline" className="font-mono text-xs">
        {token}
      </Badge>
    ))}
  </div>
);

// ── Delete confirm dialog ──────────────────────────────────────────────────────

const DeleteGrantDialog = ({
  channelId,
  grant,
  memberName,
  open,
  onOpenChange,
  onOpenChangeComplete,
  resetKey,
}: {
  channelId: string;
  grant: ChannelGrant | null;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
  resetKey: number;
}) => {
  const queryClient = useQueryClient();

  const deleteMutation = useApiMutation({
    mutationFn: async (memberId: string) => deleteChannelGrant(channelId, memberId),
    onSuccess: async () => {
      toastManager.add({ title: "Grant revoked", type: "success" });
      await queryClient.invalidateQueries({ queryKey: channelGrantsQueryKey(channelId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogPopup data-slot="dialog-popup">
        <DialogHeader>
          <DialogTitle>Revoke grant for &ldquo;{memberName}&rdquo;?</DialogTitle>
          <DialogDescription>
            This will remove all allow and deny grants for this member on the channel.
          </DialogDescription>
        </DialogHeader>
        {/* key-bump keyed child for form reset */}
        <div key={resetKey} />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              if (grant) {
                deleteMutation.mutate(grant.memberId);
              }
            }}
          >
            <Trash2Icon strokeWidth={2} data-icon="inline-start" />
            Revoke grant
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

// ── Row actions ────────────────────────────────────────────────────────────────

const GrantRowActions = ({
  grant,
  onEdit,
  onDelete,
}: {
  grant: ChannelGrant;
  onEdit: (grant: ChannelGrant) => void;
  onDelete: (grant: ChannelGrant) => void;
}) => (
  <Menu>
    <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="Grant actions" />}>
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuGroup>
        <MenuItem
          onClick={() => {
            onEdit(grant);
          }}
        >
          <PencilIcon strokeWidth={2} />
          <span>Edit</span>
        </MenuItem>
        <MenuItem
          variant="destructive"
          onClick={() => {
            onDelete(grant);
          }}
        >
          <Trash2Icon strokeWidth={2} />
          <span>Revoke</span>
        </MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

// ── Table ──────────────────────────────────────────────────────────────────────

interface BuildColumnsParams {
  memberById: Record<string, MemberItem | undefined>;
  onEdit: (grant: ChannelGrant) => void;
  onDelete: (grant: ChannelGrant) => void;
}

const buildColumns = ({
  memberById,
  onEdit,
  onDelete,
}: BuildColumnsParams): ColumnDef<ChannelGrant>[] => [
  {
    id: "member",
    accessorFn: (row) => {
      const member = memberById[row.memberId];
      return member?.user.name || member?.user.email || row.memberId;
    },
    header: "Member",
    cell: ({ row }) => {
      const member = memberById[row.original.memberId];
      const label = member?.user.name || member?.user.email || row.original.memberId;
      return <span className="font-medium">{label}</span>;
    },
    enableSorting: true,
  },
  {
    id: "effect",
    accessorFn: (row) => row.effect,
    header: "Effect",
    cell: ({ row }) => <EffectBadge effect={row.original.effect} />,
    enableSorting: true,
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => <ActionChips actions={row.original.actions} />,
    enableSorting: false,
  },
  {
    id: "rowActions",
    header: "",
    cell: ({ row }) => <GrantRowActions grant={row.original} onEdit={onEdit} onDelete={onDelete} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];

export const GrantsTableView = ({
  channelId,
  grants,
  members,
  countLabel,
  sorting,
  onSortingChange,
}: {
  channelId: string;
  grants: readonly ChannelGrant[];
  members: readonly MemberItem[];
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
}) => {
  const memberById = useMemo(
    (): Record<string, MemberItem | undefined> =>
      Object.fromEntries(members.map((member) => [member.id, member])),
    [members],
  );

  const [editGrant, setEditGrant] = useState<ChannelGrant | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editResetKey, setEditResetKey] = useState(0);

  const [deleteGrant, setDeleteGrant] = useState<ChannelGrant | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteResetKey, setDeleteResetKey] = useState(0);

  const handleEdit = useCallback((grant: ChannelGrant) => {
    setEditGrant(grant);
    setEditOpen(true);
  }, []);

  const handleDelete = useCallback((grant: ChannelGrant) => {
    setDeleteGrant(grant);
    setDeleteOpen(true);
  }, []);

  const columns = useMemo(
    () => buildColumns({ memberById, onEdit: handleEdit, onDelete: handleDelete }),
    [memberById, handleEdit, handleDelete],
  );

  const tableData = useMemo(() => [...grants], [grants]);

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

  const resolveMemberName = (grant: ChannelGrant): string => {
    const member = memberById[grant.memberId];
    return member?.user.name || member?.user.email || grant.memberId;
  };

  const deleteMemberName = deleteGrant ? resolveMemberName(deleteGrant) : "";

  return (
    <>
      <DataTableView table={table} columnsCount={columns.length} countLabel={countLabel} />

      <GrantFormDialog
        channelId={channelId}
        grant={toOptional(editGrant)}
        members={members}
        open={editOpen}
        onOpenChange={setEditOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setEditResetKey((prev) => prev + 1);
            setEditGrant(null);
          }
        }}
        resetKey={editResetKey}
      />

      <DeleteGrantDialog
        channelId={channelId}
        grant={deleteGrant}
        memberName={deleteMemberName}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setDeleteResetKey((prev) => prev + 1);
            setDeleteGrant(null);
          }
        }}
        resetKey={deleteResetKey}
      />
    </>
  );
};
