import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, LockIcon } from "lucide-react";
import { useState } from "react";

import type { PolicyItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { isManagedPolicy } from "../../../../lib/policy";
import { DeletePolicyDialog } from "./-delete-policy-dialog";
import { PolicyFormDialog } from "./-policy-form-dialog";
import { PolicyViewDialog } from "./-policy-view-dialog";

const statementSummary = (policy: PolicyItem): string => {
  const count = policy.document.statements.length;
  return `${count} statement${count === 1 ? "" : "s"}`;
};

const PolicyRowActions = ({ orgId, policy }: { orgId: string; policy: PolicyItem }) => {
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const managed = isManagedPolicy(policy.id);

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Policy actions">
              <EllipsisVerticalIcon strokeWidth={2} />
            </Button>
          }
        />
        <MenuPopup align="end" className="w-40">
          <MenuItem
            onClick={() => {
              setViewOpen(true);
            }}
          >
            View
          </MenuItem>
          {managed ? null : (
            <>
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
            </>
          )}
        </MenuPopup>
      </Menu>
      <PolicyViewDialog policy={policy} open={viewOpen} onOpenChange={setViewOpen} />
      {managed ? null : (
        <>
          <PolicyFormDialog
            orgId={orgId}
            policy={policy}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <DeletePolicyDialog
            orgId={orgId}
            policy={policy}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      )}
    </>
  );
};

export const buildPolicyColumns = (orgId: string): readonly ColumnDef<PolicyItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 font-medium">
          {row.original.name}
          {isManagedPolicy(row.original.id) ? (
            <Badge variant="secondary" className="gap-1">
              <LockIcon className="size-3" strokeWidth={2} />
              Managed
            </Badge>
          ) : null}
        </div>
        {row.original.description ? (
          <span className="text-muted-foreground truncate text-xs">{row.original.description}</span>
        ) : null}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "statements",
    header: "Statements",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{statementSummary(row.original)}</span>
    ),
    enableSorting: false,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) =>
      isManagedPolicy(row.original.id) ? (
        <span className="text-muted-foreground text-sm">Built-in</span>
      ) : (
        formatRelativeTime(row.original.createdAt)
      ),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "updatedAt",
    header: "Updated",
    cell: ({ row }) =>
      isManagedPolicy(row.original.id) || row.original.updatedAt === null ? (
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
    cell: ({ row }) => <PolicyRowActions orgId={orgId} policy={row.original} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];
