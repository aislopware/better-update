import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Folder02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orgsQueryOptions, sessionQueryOptions } from "../../../../queries/auth";
import { projectsQueryOptions } from "../../../../queries/projects";
import { CreateProjectDialog } from "./-create-dialog";

import type { ProjectItem } from "../../../../queries/projects";

const ProjectCard = ({ project }: { project: ProjectItem }) => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Folder02Icon}
          strokeWidth={2}
          className="text-muted-foreground size-5"
        />
        <CardTitle className="text-base">{project.name}</CardTitle>
      </div>
      <CardDescription>{project.scopeKey}</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex items-center justify-between">
        <Badge variant="outline">{new Date(project.createdAt).toLocaleDateString()}</Badge>
      </div>
    </CardContent>
  </Card>
);

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={Folder02Icon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No projects yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first project to start publishing updates.
      </p>
    </CardContent>
  </Card>
);

const Projects = () => {
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.user.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data } = useSuspenseQuery(projectsQueryOptions(orgId));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage your OTA update projects.</p>
        </div>
        <CreateProjectDialog orgId={orgId} />
      </div>

      {data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
