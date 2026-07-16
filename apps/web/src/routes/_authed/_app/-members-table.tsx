import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { MemberProjectMembershipsItem } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { DataTableView, PAGE_SIZE } from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { formatRelativeFuture } from "../../../lib/format-relative-time";
import { RelativeTime } from "../../../lib/relative-time";
import { MemberProjectsCell } from "./-member-projects-cell";
import { MemberRowActions } from "./-member-row-actions";
import { buildRows } from "./-members-row";

import type { ManageProjectsTarget } from "./-member-projects-cell";
import type { InvitationInput, MemberInput, MemberStatus, Row } from "./-members-row";

export type { InvitationInput, MemberInput, MemberStatus };

// Org role ladder (GITLAB-RBAC-SPEC §1): owner | admin | member.
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
const STATUS_RANK: Record<MemberStatus, number> = { active: 0, pending: 1 };

const isOwnerRole = (role: string): boolean => role === "owner";

export type EditableOrgRole = "admin" | "member";

// Stable defaults so omitted props never invalidate the columns memo.
const EMPTY_MEMBERSHIPS: ReadonlyMap<string, MemberProjectMembershipsItem> = new Map();
const NOOP_MANAGE_PROJECTS = (_target: ManageProjectsTarget): void => undefined;
const ORG_ROLE_LABELS: Record<EditableOrgRole, string> = { admin: "Admin", member: "Member" };
const ORG_ROLE_VALUES = ["admin", "member"] as const;

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

// Active is the expected state — plain quiet text. Pending is the exception,
// but stays plain text (warning-colored) so both states share the same left
// edge — a pill's own padding would misalign the column.
const StatusCell = ({ status }: { status: MemberStatus }) =>
  status === "active" ? (
    <span className="text-muted-foreground text-sm">Active</span>
  ) : (
    <span className="text-warning-foreground text-sm font-medium">Pending</span>
  );

const JoinedCell = ({ row }: { row: Row }) => {
  if (row.kind === "member") {
    return <RelativeTime value={row.joinedAt} />;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span>
        Invited <RelativeTime value={row.invitedAt} />
      </span>
      <span className="text-muted-foreground/72 text-xs italic">
        Expires {formatRelativeFuture(row.expiresAt)}
      </span>
    </div>
  );
};

interface BuildColumnsParams {
  currentUserId: string;
  canRemoveMembers: boolean;
  canEditOrgRoles: boolean;
  canManageProjects: boolean;
  membershipsByPrincipal: ReadonlyMap<string, MemberProjectMembershipsItem>;
  pendingMemberId: string | undefined;
  pendingInvitationId: string | undefined;
  pendingRoleMemberId: string | undefined;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  onRoleChange: (memberId: string, role: EditableOrgRole) => void;
  onManageProjects: (target: ManageProjectsTarget) => void;
}

const RoleBadge = ({ role }: { role: string }) => {
  if (isOwnerRole(role)) {
    return <Badge variant="default">Owner</Badge>;
  }
  if (role === "admin") {
    return <Badge variant="secondary">Admin</Badge>;
  }
  return <Badge variant="outline">Member</Badge>;
};

const RoleSelect = ({
  row,
  isPending,
  onRoleChange,
}: {
  row: Row;
  isPending: boolean;
  onRoleChange: (memberId: string, role: EditableOrgRole) => void;
}) => (
  <Select
    items={ORG_ROLE_LABELS}
    value={row.role === "admin" ? "admin" : "member"}
    disabled={isPending}
    onValueChange={(next) => {
      if ((next === "admin" || next === "member") && next !== row.role) {
        onRoleChange(row.id, next);
      }
    }}
  >
    <SelectTrigger className="w-32" aria-label={`Change role for ${row.name}`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {ORG_ROLE_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {ORG_ROLE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

// Org-role cell: owners always render a static badge (owner transfer is a
// better-auth flow, not this table); non-owner rows become a select only when
// the viewer holds member:update AND is the owner (admin grant/revoke is
// owner-only server-side). Pending invitations show their invited role.
const RoleCell = ({
  row,
  canEditOrgRoles,
  isPending,
  onRoleChange,
}: {
  row: Row;
  canEditOrgRoles: boolean;
  isPending: boolean;
  onRoleChange: (memberId: string, role: EditableOrgRole) => void;
}) => {
  const editable = canEditOrgRoles && row.kind === "member" && !isOwnerRole(row.role);
  if (!editable) {
    return <RoleBadge role={row.role} />;
  }
  return <RoleSelect row={row} isPending={isPending} onRoleChange={onRoleChange} />;
};

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
    accessorFn: (row) => ROLE_RANK[row.role] ?? 2,
    header: "Role",
    cell: ({ row }) => {
      const { canEditOrgRoles, pendingRoleMemberId, onRoleChange: handleRoleChange } = params;
      return (
        <RoleCell
          row={row.original}
          canEditOrgRoles={canEditOrgRoles}
          isPending={pendingRoleMemberId === row.original.id}
          onRoleChange={handleRoleChange}
        />
      );
    },
    enableSorting: true,
  },
  {
    id: "projects",
    header: "Projects",
    cell: ({ row }) => {
      const { membershipsByPrincipal, canManageProjects, onManageProjects } = params;
      // Invitations hold no memberships yet (they materialize on accept).
      if (row.original.kind !== "member") {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      return (
        <MemberProjectsCell
          principalId={row.original.id}
          memberName={row.original.name}
          orgRole={row.original.role}
          summary={membershipsByPrincipal.get(row.original.id)}
          canManage={canManageProjects}
          onManage={onManageProjects}
        />
      );
    },
    enableSorting: false,
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
        canRemoveMembers,
        pendingMemberId,
        pendingInvitationId,
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
          canRemoveMembers={canRemoveMembers}
          isPending={isPending}
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
  canRemoveMembers,
  canEditOrgRoles = false,
  canManageProjects = false,
  membershipsByPrincipal = EMPTY_MEMBERSHIPS,
  pendingMemberId,
  pendingInvitationId,
  pendingRoleMemberId,
  countLabel,
  emptyMessage,
  sorting,
  onSortingChange,
  onRemove,
  onCancelInvitation,
  onRoleChange,
  onManageProjects = NOOP_MANAGE_PROJECTS,
}: {
  members: readonly MemberInput[];
  invitations: readonly InvitationInput[];
  currentUserId: string;
  canRemoveMembers: boolean;
  canEditOrgRoles?: boolean;
  canManageProjects?: boolean;
  membershipsByPrincipal?: ReadonlyMap<string, MemberProjectMembershipsItem>;
  pendingMemberId?: string | undefined;
  pendingInvitationId?: string | undefined;
  pendingRoleMemberId?: string | undefined;
  countLabel?: string;
  emptyMessage?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  onRoleChange: (memberId: string, role: EditableOrgRole) => void;
  onManageProjects?: (target: ManageProjectsTarget) => void;
}) => {
  const tableData = useMemo(() => buildRows(members, invitations), [members, invitations]);
  const columns = useMemo(
    () =>
      buildColumns({
        currentUserId,
        canRemoveMembers,
        canEditOrgRoles,
        canManageProjects,
        membershipsByPrincipal,
        pendingMemberId,
        pendingInvitationId,
        pendingRoleMemberId,
        onRemove,
        onCancelInvitation,
        onRoleChange,
        onManageProjects,
      }),
    [
      currentUserId,
      canRemoveMembers,
      canEditOrgRoles,
      canManageProjects,
      membershipsByPrincipal,
      pendingMemberId,
      pendingInvitationId,
      pendingRoleMemberId,
      onRemove,
      onCancelInvitation,
      onRoleChange,
      onManageProjects,
    ],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    onSortingChange,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      countLabel={countLabel}
      safePage={table.getState().pagination.pageIndex + 1}
      totalPages={Math.max(1, table.getPageCount())}
      onPageChange={(next) => {
        table.setPageIndex(next - 1);
      }}
      emptyMessage={emptyMessage}
    />
  );
};
