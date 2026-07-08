import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { UsersIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import { PageHeader } from "../../../components/page-header";
import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  fireAndForget,
  sortParam,
  useDataTableSearch,
} from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import { invitationsQueryOptions, membersQueryOptions, meQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
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
});

const MembersSkeleton = () => (
  <div className="flex flex-col gap-3">
    <FilterBarSkeleton selectCount={1} />
    <TableSkeleton columns={5} rows={5} hasFooter={false} />
  </div>
);

// The invite CTA lives in the PageHeader (one home per primary action) but
// depends on server capabilities, so it suspends independently of the table.
const InviteHeaderAction = () => {
  const { activeOrg } = Route.useRouteContext();
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return me.canInviteMembers ? (
    <InviteDialog orgId={activeOrg.id} isOwner={me.orgRole === "owner"} />
  ) : null;
};

const MembersContent = () => {
  const { activeOrg, user } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { status: statusFilter, sort } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, onSortingChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const setStatusFilter = (next: readonly StatusFilter[]): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, status: [...next] }) }));
  };

  // "Only active selected" is the one state that never shows invitations.
  const activeOnly = statusFilter.length === 1 && statusFilter[0] === "active";
  const pendingOnly = statusFilter.length === 1 && statusFilter[0] === "pending";

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
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
  } = useMembersHandlers(orgId);

  const filteredMembers = useMemo(() => (pendingOnly ? [] : members), [pendingOnly, members]);
  const filteredInvitations = useMemo(
    () => (activeOnly ? [] : pendingInvitations),
    [activeOnly, pendingInvitations],
  );
  const visibleCount = filteredMembers.length + filteredInvitations.length;
  const inviteCta = canInviteMembers ? <InviteDialog orgId={orgId} isOwner={isOwner} /> : undefined;
  const countLabel = `${visibleCount} ${pluralize(visibleCount, "member")}`;

  const isOrgEmpty =
    statusFilter.length === 0 && members.length === 0 && pendingInvitations.length === 0;

  if (isOrgEmpty) {
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No members yet</EmptyTitle>
            <EmptyDescription>Invite your first teammate to get started.</EmptyDescription>
          </EmptyHeader>
          {inviteCta}
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <DataTableToolbar
          isFiltered={statusFilter.length > 0}
          onReset={() => {
            setStatusFilter([]);
          }}
        >
          <DataTableFacetedFilter
            title="Status"
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={(next) => {
              setStatusFilter(next.filter(isStatusFilter));
            }}
          />
        </DataTableToolbar>
        <MembersTableView
          members={filteredMembers}
          invitations={filteredInvitations}
          currentUserId={user.id}
          canRemoveMembers={canRemoveMembers}
          canEditOrgRoles={canEditOrgRoles}
          pendingMemberId={memberPendingId}
          pendingInvitationId={invitationPendingId}
          pendingRoleMemberId={rolePendingId}
          countLabel={countLabel}
          emptyMessage="No members match the selected filter."
          sorting={sorting}
          onSortingChange={onSortingChange}
          onRemove={setRemoveMemberId}
          onCancelInvitation={handleCancelInvitation}
          onRoleChange={handleRoleChange}
        />
      </div>

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
