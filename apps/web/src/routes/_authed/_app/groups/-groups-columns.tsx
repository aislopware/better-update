import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon } from "lucide-react";
import { useState } from "react";

import type { GroupItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { DeleteGroupDialog } from "./-delete-group-dialog";
import { GroupDetailDialog } from "./-group-detail-dialog";
import { GroupFormDialog } from "./-group-form-dialog";

const GroupRowActions = ({ orgId, group }: { orgId: string; group: GroupItem }) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDetailOpen(true);
          }}
        >
          Manage
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Group actions">
                <EllipsisVerticalIcon strokeWidth={2} />
              </Button>
            }
          />
          <MenuPopup align="end" className="w-40">
            <MenuItem
              onClick={() => {
                setEditOpen(true);
              }}
            >
              Edit
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <GroupDetailDialog
        orgId={orgId}
        group={group}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <GroupFormDialog orgId={orgId} group={group} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteGroupDialog
        orgId={orgId}
        group={group}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
};

export const buildGroupColumns = (orgId: string): readonly ColumnDef<GroupItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{row.original.name}</span>
        {row.original.description ? (
          <span className="text-muted-foreground truncate text-xs">{row.original.description}</span>
        ) : null}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatRelativeTime(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "updatedAt",
    header: "Updated",
    cell: ({ row }) =>
      row.original.updatedAt === null ? (
        <span className="text-muted-foreground text-sm">—</span>
      ) : (
        formatRelativeTime(row.original.updatedAt)
      ),
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <GroupRowActions orgId={orgId} group={row.original} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];
