import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { SearchXIcon, UsersIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import { PageHeader } from "../../../components/page-header";
import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import { enumParam, fireAndForget, sortParam, useDataTableSearch } from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import { invitationsQueryOptions, membersQueryOptions, meQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
import { useMembersHandlers } from "./-members-mutations";
import { MembersTableView } from "./-members-table";

const STATUS_VALUES = ["all", "active", "pending"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
};

const SORT_COLUMNS = ["name", "role", "status", "joinedAt"] as const;
const DEFAULT_SORT = "status" as const;

const membersSearchSchema = z.object({
  status: enumParam(STATUS_VALUES, "all"),
  sort: sortParam(DEFAULT_SORT),
});

const MembersSkeleton = () => (
  <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <FilterBarSkeleton selectCount={1} />
      <Skeleton className="h-9 w-32 rounded-md" />
    </div>
    <TableSkeleton columns={4} rows={5} hasFooter={false} />
  </div>
);

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

  const setStatusFilter = (next: StatusFilter): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, status: next }) }));
  };

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { data: invitations = [] } = useQuery({
    ...invitationsQueryOptions(orgId),
    enabled: statusFilter !== "active",
    placeholderData: keepPreviousData,
  });

  // Per-action capabilities come from the server, not the role string — each
  // mirrors the exact token its endpoint gates on (invitation:create / member:delete
  // / policy:update on org). A role-"member" principal holding managed:admin (or a
  // matching custom policy) sees exactly the actions it can actually perform.
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const { canInviteMembers, canRemoveMembers, canManagePolicies } = me;

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
    handleCancelInvitation,
    memberPendingId,
    invitationPendingId,
    isRemoving,
  } = useMembersHandlers(orgId);

  const filteredMembers = useMemo(
    () => (statusFilter === "pending" ? [] : members),
    [statusFilter, members],
  );
  const filteredInvitations = useMemo(
    () => (statusFilter === "active" ? [] : pendingInvitations),
    [statusFilter, pendingInvitations],
  );
  const visibleCount = filteredMembers.length + filteredInvitations.length;
  const headerActions = canInviteMembers ? <InviteDialog orgId={orgId} /> : undefined;
  const countLabel = `${visibleCount} ${pluralize(visibleCount, "member")}`;

  const isOrgEmpty =
    statusFilter === "all" && members.length === 0 && pendingInvitations.length === 0;

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
          {headerActions}
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select
            items={STATUS_LABELS}
            value={statusFilter}
            onValueChange={(next) => {
              if (next !== null) {
                setStatusFilter(next);
              }
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {STATUS_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
          {headerActions}
        </div>
        {visibleCount === 0 ? (
          <Card>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon strokeWidth={1.5} />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>No members match the selected filter.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          <MembersTableView
            orgId={orgId}
            members={filteredMembers}
            invitations={filteredInvitations}
            currentUserId={user.id}
            canRemoveMembers={canRemoveMembers}
            canManagePolicies={canManagePolicies}
            pendingMemberId={memberPendingId}
            pendingInvitationId={invitationPendingId}
            countLabel={countLabel}
            sorting={sorting}
            onSortingChange={onSortingChange}
            onRemove={setRemoveMemberId}
            onCancelInvitation={handleCancelInvitation}
          />
        )}
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
