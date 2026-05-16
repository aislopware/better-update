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
import { SearchXIcon, UsersIcon } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import { PageHeader } from "../../../components/page-header";
import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import { pluralize } from "../../../lib/pluralize";
import { invitationsQueryOptions, membersQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
import { useMembersHandlers } from "./-members-mutations";
import { MembersTableView } from "./-members-table";

type StatusFilter = "all" | "active" | "pending";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
};

const STATUS_VALUES: readonly StatusFilter[] = ["all", "active", "pending"];

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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { data: invitations = [] } = useQuery({
    ...invitationsQueryOptions(orgId),
    enabled: statusFilter !== "active",
    placeholderData: keepPreviousData,
  });

  const currentMember = members.find((member) => member.userId === user.id);
  const currentRole = currentMember?.role ?? "member";
  const isOwnerOrAdmin = currentRole === "owner" || currentRole === "admin";

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === "pending"),
    [invitations],
  );

  const {
    removeMemberId,
    setRemoveMemberId,
    handleRoleChange,
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
  const headerActions = isOwnerOrAdmin ? <InviteDialog orgId={orgId} /> : undefined;
  const countLabel = `${visibleCount} ${pluralize(visibleCount, "member")}`;

  const isOrgEmpty =
    statusFilter === "all" && members.length === 0 && pendingInvitations.length === 0;

  if (isOrgEmpty) {
    return (
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
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon strokeWidth={1.5} />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>No members match the selected filter.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <MembersTableView
            members={filteredMembers}
            invitations={filteredInvitations}
            currentUserId={user.id}
            currentRole={currentRole}
            pendingMemberId={memberPendingId}
            pendingInvitationId={invitationPendingId}
            countLabel={countLabel}
            onRoleChange={handleRoleChange}
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
      description="Invite teammates and manage their roles within this organization."
    />
    <Suspense fallback={<MembersSkeleton />}>
      <MembersContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/members")({
  component: MembersPage,
});
