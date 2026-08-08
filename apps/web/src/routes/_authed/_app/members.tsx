import { memberProjectMembershipsQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { UsersIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import { PageHeader } from "../../../components/page-header";
import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  fireAndForget,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../lib/data-table";
import { invitationsQueryOptions, membersQueryOptions, meQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
import { ManageProjectsDialog } from "./-member-projects-cell";
import { useMembersHandlers } from "./-members-mutations";
import { MembersTableView } from "./-members-table";

const STATUS_VALUES = ["active", "pending"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

// An empty chip selection means "all statuses".
const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
] as const;

const isStatusFilter = (value: unknown): value is StatusFilter =>
  (STATUS_VALUES as readonly unknown[]).includes(value);

const SORT_COLUMNS = ["name", "role", "status", "joinedAt"] as const;
const DEFAULT_SORT = "status" as const;

const membersSearchSchema = z.object({
  status: enumArrayParam(STATUS_VALUES),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
});

const SEARCH_DEBOUNCE_MS = 300;

// Members and invitations both arrive in full — the org roster is small and the
// table pages it client-side — so the search narrows what is already here. It
// still lives in the URL, so a filtered roster is a link you can send.
// `needle` is pre-lowercased by the caller; exported for tests.
export const matchesQuery = (needle: string, ...haystack: readonly string[]): boolean =>
  needle === "" || haystack.some((value) => value.toLowerCase().includes(needle));

const MembersSkeleton = () => (
  <div className="flex flex-col gap-3">
    <FilterBarSkeleton selectCount={1} hasSearch />
    <TableSkeleton columns={6} rows={5} />
  </div>
);

// The invite CTA lives in the PageHeader (one home per primary action) but
// depends on server capabilities, so it suspends independently of the table.
const InviteHeaderAction = () => {
  const { activeOrg } = Route.useRouteContext();
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return me.canInviteMembers ? (
    <InviteDialog
      orgId={activeOrg.id}
      isOwner={me.orgRole === "owner"}
      canGrantAllProjects={me.canManageMembers}
    />
  ) : null;
};

// One map lookup per row: principalId (org member.id) → membership summary.
const useMembershipsByPrincipal = (orgId: string) => {
  const { data: memberships } = useSuspenseQuery(memberProjectMembershipsQueryOptions(orgId));
  return useMemo(
    () => new Map(memberships.map((summary) => [summary.principalId, summary] as const)),
    [memberships],
  );
};

// Everything that narrows the roster, read from and written back to the URL:
// sort, the status chips, and the search box. Kept out of the page body so the
// component below is about members rather than about search params.
const useMembersFilters = () => {
  const { status: statusFilter, sort, query } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, onSortingChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: query,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        navigate({ to: ".", search: (prev) => ({ ...prev, query: value }), replace: true }),
      );
    },
  });

  const handleStatusChange = (next: readonly string[]): void => {
    fireAndForget(
      navigate({ to: ".", search: (prev) => ({ ...prev, status: next.filter(isStatusFilter) }) }),
    );
  };

  const handleResetFilters = (): void => {
    handleSearchChange("");
    fireAndForget(
      navigate({ to: ".", search: (prev) => ({ ...prev, status: [], query: "" }), replace: true }),
    );
  };

  const needle = query.trim().toLowerCase();
  return {
    statusFilter,
    needle,
    searchDraft,
    sorting,
    isFiltered: statusFilter.length > 0 || needle !== "",
    onSortingChange,
    handleSearchChange,
    handleStatusChange,
    handleResetFilters,
  };
};

const MembersContent = () => {
  const { activeOrg, user } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const {
    statusFilter,
    needle,
    searchDraft,
    sorting,
    isFiltered,
    onSortingChange,
    handleSearchChange,
    handleStatusChange,
    handleResetFilters,
  } = useMembersFilters();

  // "Only active selected" is the one state that never shows invitations.
  const activeOnly = statusFilter.length === 1 && statusFilter[0] === "active";
  const pendingOnly = statusFilter.length === 1 && statusFilter[0] === "pending";

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const membershipsByPrincipal = useMembershipsByPrincipal(orgId);
  const { data: invitations = [] } = useQuery({
    ...invitationsQueryOptions(orgId),
    enabled: !activeOnly,
    placeholderData: keepPreviousData,
  });

  // Per-action capabilities come from the server, not the role string — each
  // mirrors the exact token its endpoint gates on (invitation:create /
  // member:delete / member:update on org). The role select is additionally
  // owner-only: granting/revoking admin is an owner power (GITLAB-RBAC-SPEC §2).
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const { canInviteMembers, canRemoveMembers, canManageMembers, orgRole } = me;
  const isOwner = orgRole === "owner";
  const canEditOrgRoles = canManageMembers && isOwner;

  // The IAM list endpoint returns invitations with ISO-string `expiresAt` and a
  // nullable `role`; map them to the table's `InvitationInput` shape (Date +
  // baseline "member" role) here so the table stays decoupled from the wire type.
  const pendingInvitations = useMemo(
    () =>
      invitations
        .filter((inv) => inv.status === "pending")
        .map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role ?? "member",
          createdAt: new Date(inv.createdAt),
          expiresAt: new Date(inv.expiresAt),
        })),
    [invitations],
  );

  const {
    removeMemberId,
    setRemoveMemberId,
    handleRemove,
    handleRoleChange,
    handleCancelInvitation,
    memberPendingId,
    rolePendingId,
    invitationPendingId,
    isRemoving,
    manageProjectsTarget,
    manageProjectsOpen,
    openManageProjects,
    closeManageProjects,
    clearManageProjects,
  } = useMembersHandlers(orgId);

  const filteredMembers = useMemo(
    () =>
      pendingOnly
        ? []
        : members.filter((member) => matchesQuery(needle, member.user.name, member.user.email)),
    [pendingOnly, members, needle],
  );
  const filteredInvitations = useMemo(
    () =>
      activeOnly
        ? []
        : pendingInvitations.filter((invitation) => matchesQuery(needle, invitation.email)),
    [activeOnly, pendingInvitations, needle],
  );
  const inviteCta = canInviteMembers ? (
    <InviteDialog orgId={orgId} isOwner={isOwner} canGrantAllProjects={canManageMembers} />
  ) : undefined;
  const isOrgEmpty =
    statusFilter.length === 0 &&
    needle === "" &&
    members.length === 0 &&
    pendingInvitations.length === 0;

  if (isOrgEmpty) {
    return (
      <Empty
        icon={<UsersIcon className="text-kumo-inactive size-10" />}
        title="No members yet"
        description="Invite your first teammate to get started."
        contents={inviteCta}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <DataTableToolbar
          search={{
            value: searchDraft,
            onChange: handleSearchChange,
            placeholder: "Search members…",
          }}
          isFiltered={isFiltered}
          onReset={handleResetFilters}
        >
          <DataTableFacetedFilter
            title="Status"
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={handleStatusChange}
          />
        </DataTableToolbar>
        <MembersTableView
          members={filteredMembers}
          invitations={filteredInvitations}
          currentUserId={user.id}
          canRemoveMembers={canRemoveMembers}
          canEditOrgRoles={canEditOrgRoles}
          canManageProjects={canManageMembers}
          membershipsByPrincipal={membershipsByPrincipal}
          pendingMemberId={memberPendingId}
          pendingInvitationId={invitationPendingId}
          pendingRoleMemberId={rolePendingId}
          emptyMessage="No members match the selected filter."
          filteredEmpty={{ entity: "members", isFiltered, onClear: handleResetFilters }}
          sorting={sorting}
          onSortingChange={onSortingChange}
          onRemove={setRemoveMemberId}
          onCancelInvitation={handleCancelInvitation}
          onRoleChange={handleRoleChange}
          onManageProjects={openManageProjects}
        />
      </div>

      <ManageProjectsDialog
        orgId={orgId}
        open={manageProjectsOpen}
        target={manageProjectsTarget}
        summary={
          manageProjectsTarget === null
            ? undefined
            : membershipsByPrincipal.get(manageProjectsTarget.id)
        }
        onClose={closeManageProjects}
        onClosed={clearManageProjects}
      />

      <RemoveDialog
        open={removeMemberId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveMemberId(null);
          }
        }}
        onConfirm={handleRemove}
        isRemoving={isRemoving}
      />
    </>
  );
};

const MembersPage = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Members"
      description="Invite teammates and manage their access within this organization."
      actions={
        <Suspense fallback={<Skeleton className="h-8 w-32 rounded-md" />}>
          <InviteHeaderAction />
        </Suspense>
      }
    />
    <Suspense fallback={<MembersSkeleton />}>
      <MembersContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/members")({
  validateSearch: zodValidator(membersSearchSchema),
  component: MembersPage,
});
