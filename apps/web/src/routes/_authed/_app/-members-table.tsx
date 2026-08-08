import { Select } from "@better-update/ui/components/select";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { MemberProjectMembershipsItem } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { StatusDot } from "../../../components/status-dot";
import { DataTableView, PAGE_SIZE } from "../../../lib/data-table";
import { onPicked } from "../../../lib/form-utils";
import { formatRelativeFuture } from "../../../lib/format-relative-time";
import { pluralize } from "../../../lib/pluralize";
import { RelativeTime } from "../../../lib/relative-time";
import { MemberProjectsCell } from "./-member-projects-cell";
import { MemberRowActions } from "./-member-row-actions";
import { buildRows } from "./-members-row";

import type { FilteredEmptyProps } from "../../../lib/data-table";
import type { ManageProjectsTarget } from "./-member-projects-cell";
import type { InvitationInput, MemberInput, MemberStatus, Row } from "./-members-row";

export type { InvitationInput, MemberInput };

// Org role ladder (GITLAB-RBAC-SPEC §1): owner | admin | member.
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
const STATUS_RANK: Record<MemberStatus, number> = { active: 0, pending: 1 };

const isOwnerRole = (role: string): boolean => role === "owner";

export type EditableOrgRole = "admin" | "member";

// Stable defaults so omitted props never invalidate the columns memo.
const EMPTY_MEMBERSHIPS: ReadonlyMap<string, MemberProjectMembershipsItem> = new Map();
const NOOP_MANAGE_PROJECTS = (_target: ManageProjectsTarget): void => undefined;
const ORG_ROLE_LABELS: Record<EditableOrgRole, string> = { admin: "Admin", member: "Member" };
// The ladder in full, including the rung the select cannot offer.
const ORG_ROLE_TEXT: Record<string, string> = { owner: "Owner", ...ORG_ROLE_LABELS };

/**
 * Who the row is: their name over their address, or just the address on an
 * invitation, which has no name yet.
 *
 * There used to be a generated avatar in front of both — a 36px disc whose hue
 * came from hashing the name printed right beside it, so it told you nothing you
 * were not already reading. Eight of them made a column of saturated circles
 * down the left edge, the loudest ink on a page whose one real exception is an
 * amber dot in the Status column, and they set the row height on their own.
 */
const MemberCell = ({ row }: { row: Row }) => {
  if (row.kind === "member") {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{row.name}</span>
        <span className="text-kumo-subtle truncate text-xs">{row.email}</span>
      </div>
    );
  }
  return <span className="truncate text-sm font-medium">{row.email}</span>;
};

// Dot + label for both states, so the column reads as one vocabulary instead of
// quiet text next to a colored word. The dot also keeps the labels on a shared
// left edge, which a badge's own padding would have broken. Colour marks the
// exception: an active member is the ordinary case and needs none, while a
// pending invite is waiting on someone, so its dot is amber and pulses.
const StatusCell = ({ status }: { status: MemberStatus }) =>
  status === "active" ? (
    <StatusDot tone="muted" className="text-kumo-subtle">
      Active
    </StatusDot>
  ) : (
    <StatusDot tone="warning" pulse>
      Pending
    </StatusDot>
  );

const JoinedCell = ({ row }: { row: Row }) => {
  if (row.kind === "member") {
    return <RelativeTime value={row.joinedAt} />;
  }
  // An invitation has no join date; what it has is a clock running out, which is
  // the one thing about it anybody acts on.
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span>
        Invited <RelativeTime value={row.invitedAt} />
      </span>
      <span className="text-kumo-subtle text-xs">
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

/**
 * The role where it cannot be changed.
 *
 * All three used to be badges, which gave one column three shapes and put the
 * loudest of them — a filled black pill — on "Owner", the least surprising fact
 * on a page you can only reach by belonging to the organization. It reads as
 * words now, inset and sized like the text inside the select beside it so the
 * column still has one left edge.
 */
const RoleText = ({ role }: { role: string }) => (
  <span className="px-2 text-xs">{ORG_ROLE_TEXT[role] ?? role}</span>
);

const RoleSelect = ({
  row,
  isPending,
  onRoleChange,
}: {
  row: Row;
  isPending: boolean;
  onRoleChange: (memberId: string, role: EditableOrgRole) => void;
}) => {
  // Owners never reach here, so anything that is not an admin is a member.
  const role: EditableOrgRole = row.role === "admin" ? "admin" : "member";
  return (
    <Select
      size="sm"
      className="w-32"
      aria-label={`Change role for ${row.name}`}
      items={ORG_ROLE_LABELS}
      value={role}
      disabled={isPending}
      onValueChange={onPicked((next: EditableOrgRole) => {
        if (next !== role) {
          onRoleChange(row.id, next);
        }
      })}
    />
  );
};

// Org-role cell: owners always read as text (owner transfer is a better-auth
// flow, not this table); non-owner rows become a select only when
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
    return <RoleText role={row.role} />;
  }
  return <RoleSelect row={row} isPending={isPending} onRoleChange={onRoleChange} />;
};

const buildColumns = (params: BuildColumnsParams): ColumnDef<Row>[] => [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: "Member",
    cell: ({ row }) => <MemberCell row={row.original} />,
    enableSorting: true,
    meta: { primary: true },
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
      const { membershipsByPrincipal } = params;
      // Invitations hold no memberships yet (they materialize on accept).
      if (row.original.kind !== "member") {
        return <span className="text-kumo-subtle text-sm">—</span>;
      }
      return (
        <MemberProjectsCell
          orgRole={row.original.role}
          summary={membershipsByPrincipal.get(row.original.id)}
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
        canManageProjects,
        pendingMemberId,
        pendingInvitationId,
        onRemove: handleRemove,
        onCancelInvitation: handleCancelInvitation,
        onManageProjects: handleManageProjects,
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
          canManageProjects={canManageProjects}
          isPending={isPending}
          onRemove={handleRemove}
          onCancelInvitation={handleCancelInvitation}
          onManageProjects={handleManageProjects}
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
  emptyMessage,
  filteredEmpty,
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
  emptyMessage?: string;
  /** Zero-result state while search/filters are on — offers to clear them. */
  filteredEmpty?: FilteredEmptyProps | undefined;
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

  // The footer counts what the table holds, filters included — the page
  // upstream no longer has to thread a label down for it.
  const rowCount = table.getPrePaginationRowModel().rows.length;

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      pagination={{
        page: table.getState().pagination.pageIndex + 1,
        perPage: PAGE_SIZE,
        totalCount: rowCount,
        entity: pluralize(rowCount, "member"),
        onChange: (next) => {
          table.setPageIndex(next - 1);
        },
      }}
      emptyMessage={emptyMessage}
      filteredEmpty={filteredEmpty}
    />
  );
};
