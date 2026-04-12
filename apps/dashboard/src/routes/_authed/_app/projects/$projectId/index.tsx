import { branchesQueryOptions, projectQueryOptions } from "@better-update/api-client/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { orgsQueryOptions, sessionQueryOptions } from "../../../../../queries/auth";
import { AnalyticsTab } from "./-analytics-tab";
import { BranchCard } from "./-branch-card";
import { BranchesEmptyState } from "./-branches-empty-state";
import { BuildsTab } from "./-builds-tab";
import { ChannelsTab } from "./-channels-tab";
import { CreateBranchDialog } from "./-create-branch-dialog";
import { DeleteProjectSection } from "./-delete-project-section";
import { EnvVarsTab } from "./-env-vars-tab";
import { RenameProjectSection } from "./-rename-project-section";
import { UpdatesTab } from "./-updates-tab";

const ProjectDetail = () => {
  const { projectId } = Route.useParams();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          to="/projects"
          className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm transition-colors"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
          Back to projects
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground mt-1">
            Manage branches and channels for this project.
          </p>
        </div>
      </div>

      <Tabs defaultValue="branches">
        <TabsList>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="builds">Builds</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="env-vars">Env Variables</TabsTrigger>
        </TabsList>

        <TabsContent value="branches">
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <CreateBranchDialog orgId={orgId} projectId={projectId} />
            </div>
            {branchesData.items.length === 0 ? (
              <BranchesEmptyState />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {branchesData.items.map((branch) => (
                  <BranchCard key={branch.id} branch={branch} orgId={orgId} projectId={projectId} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="channels">
          <ChannelsTab orgId={orgId} projectId={projectId} />
        </TabsContent>

        <TabsContent value="updates">
          <UpdatesTab orgId={orgId} projectId={projectId} />
        </TabsContent>

        <TabsContent value="builds">
          <BuildsTab orgId={orgId} projectId={projectId} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab orgId={orgId} projectId={projectId} />
        </TabsContent>

        <TabsContent value="env-vars">
          <EnvVarsTab orgId={orgId} projectId={projectId} />
        </TabsContent>
      </Tabs>

      <RenameProjectSection project={project} />
      <DeleteProjectSection project={project} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/")({
  component: ProjectDetail,
});
