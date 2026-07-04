import { projectsQueryOptions, robotAccountsQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { Suspense, useMemo } from "react";

import { PageHeader } from "../../../components/page-header";
import { TableSkeleton } from "../../../components/skeletons";
import { assertCapability } from "../../../lib/access";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";
import { RobotAccountsTable } from "./-robot-accounts-table";

const RobotAccountsEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No robot accounts yet</EmptyTitle>
        <EmptyDescription>
          Robot accounts are created from the CLI: run{" "}
          <code className="font-mono text-xs">better-update credentials robot create</code> from an
          admin device.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const RobotAccountsContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const { data: items } = useSuspenseQuery(robotAccountsQueryOptions(activeOrg.id));
  // `status: "all"` so robots on archived projects still resolve to a project
  // name instead of a raw id.
  const { data: projectsResult } = useSuspenseQuery(
    projectsQueryOptions(activeOrg.id, { limit: DROPDOWN_FETCH_LIMIT, status: "all" }),
  );
  const projectNamesById = useMemo(
    () => new Map(projectsResult.items.map((project) => [project.id, project.name])),
    [projectsResult.items],
  );

  if (items.length === 0) {
    return <RobotAccountsEmptyState />;
  }

  return (
    <Frame>
      <RobotAccountsTable items={items} projectNamesById={projectNamesById} />
    </Frame>
  );
};

const RobotAccounts = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Robot accounts"
      description="Project-scoped CI identities — one robot per project and role, bearer secret and vault identity in one. Created, rotated, and revoked exclusively from the CLI."
    />
    <Suspense fallback={<TableSkeleton columns={5} rows={3} hasFooter={false} />}>
      <RobotAccountsContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/robot-accounts")({
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canViewRobots");
  },
  component: RobotAccounts,
});
