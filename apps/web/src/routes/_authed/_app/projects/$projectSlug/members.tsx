import { meQueryOptions, projectMembersQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { UsersIcon } from "lucide-react";
import { Suspense } from "react";
import { z } from "zod";

import type { MeResult } from "@better-update/api-client/react";
import type { ReactNode } from "react";

import { SectionHeader } from "../../../../../components/page-header";
import { TableSkeleton } from "../../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { AddProjectMemberDialog } from "./-project-members-add-dialog";
import { useProjectMembersHandlers } from "./-project-members-mutations";
import { ProjectMembersTableView } from "./-project-members-table";

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
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Remove from project</DialogTitle>
        <DialogDescription>
          Remove {name} from this project? They keep their organization membership but lose access
          to this project immediately.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button variant="destructive" loading={isRemoving} onClick={onConfirm}>
          Remove
        </Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);

const EmptyMembers = ({ actions }: { actions?: ReactNode }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No project members yet</EmptyTitle>
        <EmptyDescription>
          Organization owners and admins always have access. Add members to grant a role on this
          project.
        </EmptyDescription>
      </EmptyHeader>
      {actions}
    </Empty>
  </Card>
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
      <SectionHeader
        title="Members"
        description="Who can access this project, and with which role. Organization owners and admins are implicit Maintainers and are not listed."
        actions={headerActions}
      />
      {items.length === 0 ? (
        <EmptyMembers actions={headerActions} />
      ) : (
        <ProjectMembersTableView
          items={items}
          canManage={canManage}
          pendingPrincipalId={pendingPrincipalId}
          countLabel={`${items.length} ${pluralize(items.length, "member")}`}
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
  <div className="flex flex-col gap-3">
    <Suspense fallback={<TableSkeleton columns={4} rows={3} hasFooter={false} />}>
      <ProjectMembersContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/members")({
  validateSearch: zodValidator(projectMembersSearchSchema),
  component: ProjectMembersPage,
});
