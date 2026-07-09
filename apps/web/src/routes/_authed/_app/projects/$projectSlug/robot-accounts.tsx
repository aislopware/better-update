import { meQueryOptions, projectRobotAccountsQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BotIcon, LockIcon } from "lucide-react";
import { Suspense } from "react";

import type { MeResult } from "@better-update/api-client/react";

import { CliCommandBlock } from "../../../../../components/cli-command-block";
import { SectionHeader } from "../../../../../components/page-header";
import { TableSkeleton } from "../../../../../components/skeletons";
import { ProjectRobotsTable } from "./-project-robots-table";

// Robot visibility is maintainer-gated (GITLAB-RBAC-SPEC §1b): org owner/admin
// are implicit maintainers everywhere; everyone else needs an explicit
// maintainer row on THIS project. UX only — the endpoint stays IAM-gated and
// simply returns nothing for lower ranks.
const canViewProjectRobots = (me: MeResult, projectId: string): boolean =>
  me.orgRole === "owner" || me.orgRole === "admin" || me.projectRoles[projectId] === "maintainer";

const EmptyRobots = ({ projectId }: { projectId: string }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No robot accounts yet</EmptyTitle>
        <EmptyDescription>
          Robot accounts are created from the CLI on a maintainer device — one robot per project,
          minted together with its vault access.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CliCommandBlock
          commands={[
            `better-update credentials robot create --project ${projectId} --role developer`,
          ]}
        />
      </EmptyContent>
    </Empty>
  </Card>
);

const MaintainerRequired = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>Maintainer access required</EmptyTitle>
        <EmptyDescription>
          Only project maintainers (and organization owners/admins) can see the robot accounts of
          this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const ProjectRobotsContent = () => {
  const { project } = Route.useRouteContext();
  const { data: me } = useSuspenseQuery(meQueryOptions());

  if (!canViewProjectRobots(me, project.id)) {
    return <MaintainerRequired />;
  }
  return <ProjectRobotsList projectId={project.id} />;
};

const ProjectRobotsList = ({ projectId }: { projectId: string }) => {
  const { data: items } = useSuspenseQuery(projectRobotAccountsQueryOptions(projectId));

  if (items.length === 0) {
    return <EmptyRobots projectId={projectId} />;
  }
  return <ProjectRobotsTable projectId={projectId} items={items} />;
};

const ProjectRobotsPage = () => (
  <div className="flex flex-col gap-3">
    <SectionHeader
      title="Robot accounts"
      description="This project's CI identities — one robot per project, bearer secret and vault identity in one. Rename or change roles here; creating, rotating, and revoking stay CLI-only."
    />
    <Suspense fallback={<TableSkeleton columns={4} rows={3} hasFooter={false} />}>
      <ProjectRobotsContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/robot-accounts")({
  component: ProjectRobotsPage,
});
