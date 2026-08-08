import { meQueryOptions, projectMembersQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { UsersIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense } from "react";
import { z } from "zod";

import type { MeResult } from "@better-update/api-client/react";

import { ConfirmDialog } from "../../../../../components/confirm-dialog";
import { PageHeader } from "../../../../../components/page-header";
import { TableSkeleton } from "../../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../../lib/data-table";
import { AddProjectMemberDialog } from "./-project-members-add-dialog";
import { useProjectMembersHandlers } from "./-project-members-mutations";
import { ProjectMembersTableView } from "./-project-members-table";

const MEMBERS_DESCRIPTION =
  "Who can access this project, and with which role. Organization owners and admins are implicit Maintainers and are not listed.";

const SORT_COLUMNS = ["name", "role", "addedAt"] as const;
const DEFAULT_SORT = "role" as const;

const projectMembersSearchSchema = z.object({
  sort: sortParam(DEFAULT_SORT),
});

// Project-member management is maintainer-gated (GITLAB-RBAC-SPEC §2):
// org owner/admin are implicit maintainers everywhere; everyone else needs an
// explicit maintainer row on THIS project. UX only — the routes stay IAM-gated.
const canManageProjectMembers = (me: MeResult, projectId: string): boolean =>
  me.orgRole === "owner" || me.orgRole === "admin" || me.projectRoles[projectId] === "maintainer";

const RemoveProjectMemberDialog = ({
  name,
  open,
  onOpenChange,
  onConfirm,
  isRemoving,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isRemoving: boolean;
}) => (
  <ConfirmDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Remove from project"
    description={`Remove ${name} from this project? They keep their organization membership but lose access to this project immediately.`}
    confirmLabel="Remove"
    isPending={isRemoving}
    onConfirm={onConfirm}
  />
);

// The header already carries the Add member button, as it does on every other
// list in the dashboard — the empty state says what the page is for and lets
// that one button stand.
//
// It also stops repeating the owners-and-admins rule. The page description says
// it three lines above, and saying it twice on one screen reads as two separate
// facts the reader has to check against each other.
const EmptyMembers = () => (
  <Empty
    icon={<UsersIcon className="text-kumo-inactive size-10" />}
    title="No project members yet"
    description="Add a teammate to give them a role here."
  />
);

const ProjectMembersContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { sort } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, onSortingChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const { data: items } = useSuspenseQuery(projectMembersQueryOptions(project.id));
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const canManage = canManageProjectMembers(me, project.id);

  const {
    removeTarget,
    setRemoveTarget,
    handleRoleChange,
    handleRemove,
    pendingPrincipalId,
    isRemoving,
  } = useProjectMembersHandlers(project.id);

  const headerActions = canManage ? (
    <AddProjectMemberDialog orgId={activeOrg.id} projectId={project.id} existingMembers={items} />
  ) : undefined;

  return (
    <>
      <PageHeader title="Members" description={MEMBERS_DESCRIPTION} actions={headerActions} />
      {items.length === 0 ? (
        <EmptyMembers />
      ) : (
        <ProjectMembersTableView
          items={items}
          canManage={canManage}
          pendingPrincipalId={pendingPrincipalId}
          sorting={sorting}
          onSortingChange={onSortingChange}
          onRoleChange={(row, role) => {
            handleRoleChange(row.principalId, role);
          }}
          onRemove={setRemoveTarget}
        />
      )}
      <RemoveProjectMemberDialog
        name={removeTarget?.name ?? "this member"}
        open={removeTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveTarget(null);
          }
        }}
        onConfirm={handleRemove}
        isRemoving={isRemoving}
      />
    </>
  );
};

const ProjectMembersPage = () => (
  <div className="flex flex-col gap-4">
    <Suspense
      fallback={
        <>
          {/* The title does not depend on the query, so it is there from the
              first paint like every other page — a bare skeleton with no
              heading reads as a page that failed rather than one still loading. */}
          <PageHeader title="Members" description={MEMBERS_DESCRIPTION} />
          <TableSkeleton columns={4} rows={3} hasFooter={false} />
        </>
      }
    >
      <ProjectMembersContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/members")({
  validateSearch: zodValidator(projectMembersSearchSchema),
  component: ProjectMembersPage,
});
