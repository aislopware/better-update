import { Badge } from "@better-update/ui/components/ui/badge";
import { cn } from "@better-update/ui/lib/utils";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { DataTableView } from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { formatRelativeFuture, formatRelativeTime } from "../../../lib/format-relative-time";
import { MemberRowActions } from "./-member-row-actions";
import { buildRows } from "./-members-row";

import type { InvitationInput, MemberInput, MemberStatus, Row } from "./-members-row";

export type { InvitationInput, MemberInput, MemberStatus };

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
const STATUS_RANK: Record<MemberStatus, number> = { active: 0, pending: 1 };

const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
  if (role === "owner") {
    return "default";
  }
  if (role === "admin") {
    return "secondary";
  }
  return "outline";
};

const MemberAvatarCell = ({ row }: { row: Row }) => {
  if (row.kind === "member") {
    return (
      <div className="flex items-center gap-3">
        <EntityAvatar name={row.name || "U"} image={row.image} className="size-9" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-none font-medium">{row.name}</span>
          <span className="text-muted-foreground truncate text-xs">{row.email}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="bg-muted/72 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-medium">
        {row.email.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm leading-none font-medium">{row.email}</span>
        <span className="text-muted-foreground truncate text-xs">Invited</span>
      </div>
    </div>
  );
};

const StatusCell = ({ status }: { status: MemberStatus }) => {
  const dotClass = status === "active" ? "bg-success" : "bg-warning";
  const label = status === "active" ? "Active" : "Pending";
  return (
    <Badge variant="outline" className="gap-1.5">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dotClass)} />
      {label}
    </Badge>
  );
};

const JoinedCell = ({ row }: { row: Row }) => {
  if (row.kind === "member") {
    return formatRelativeTime(row.joinedAt.toISOString());
  }
  return (
    <span className="text-muted-foreground italic">
      Expires {formatRelativeFuture(row.expiresAt.toISOString())}
    </span>
  );
};

interface BuildColumnsParams {
  currentUserId: string;
  currentRole: string;
  pendingMemberId: string | undefined;
  pendingInvitationId: string | undefined;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
}

const buildColumns = (params: BuildColumnsParams): ColumnDef<Row>[] => [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: "Member",
    cell: ({ row }) => <MemberAvatarCell row={row.original} />,
    enableSorting: true,
  },
  {
    id: "role",
    accessorFn: (row) => ROLE_RANK[row.role] ?? 99,
    header: "Role",
    cell: ({ row }) => (
      <Badge variant={roleBadgeVariant(row.original.role)} className="capitalize">
        {row.original.role}
      </Badge>
    ),
    enableSorting: true,
  },
  {
    id: "status",
    accessorFn: (row) => STATUS_RANK[row.status],
    header: "Status",
    cell: ({ row }) => <StatusCell status={row.original.status} />,
    enableSorting: true,
  },
  {
    id: "joinedAt",
    accessorFn: (row) => (row.kind === "member" ? row.joinedAt.getTime() : row.expiresAt.getTime()),
    header: "Joined",
    cell: ({ row }) => <JoinedCell row={row.original} />,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const {
        currentUserId,
        currentRole,
        pendingMemberId,
        pendingInvitationId,
        onRoleChange: handleRoleChange,
        onRemove: handleRemove,
        onCancelInvitation: handleCancelInvitation,
      } = params;
      const isPending =
        row.original.kind === "member"
          ? pendingMemberId === row.original.id
          : pendingInvitationId === row.original.id;
      return (
        <MemberRowActions
          row={row.original}
          currentUserId={currentUserId}
          currentRole={currentRole}
          isPending={isPending}
          onRoleChange={handleRoleChange}
          onRemove={handleRemove}
          onCancelInvitation={handleCancelInvitation}
        />
      );
    },
    enableSorting: false,
    meta: { align: "right" },
  },
];

export const MembersTableView = ({
  members,
  invitations,
  currentUserId,
  currentRole,
  pendingMemberId,
  pendingInvitationId,
  countLabel,
  sorting,
  onSortingChange,
  onRoleChange,
  onRemove,
  onCancelInvitation,
}: {
  members: readonly MemberInput[];
  invitations: readonly InvitationInput[];
  currentUserId: string;
  currentRole: string;
  pendingMemberId?: string | undefined;
  pendingInvitationId?: string | undefined;
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
}) => {
  const tableData = useMemo(() => buildRows(members, invitations), [members, invitations]);
  const columns = useMemo(
    () =>
      buildColumns({
        currentUserId,
        currentRole,
        pendingMemberId,
        pendingInvitationId,
        onRoleChange,
        onRemove,
        onCancelInvitation,
      }),
    [
      currentUserId,
      currentRole,
      pendingMemberId,
      pendingInvitationId,
      onRoleChange,
      onRemove,
      onCancelInvitation,
    ],
  );

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

  return <DataTableView table={table} columnsCount={columns.length} countLabel={countLabel} />;
};
