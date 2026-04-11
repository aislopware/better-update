import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
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
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import type { ProjectItem } from "@better-update/api-client/react";

import { orgsQueryOptions, sessionQueryOptions } from "../../../../queries/auth";
import { CreateProjectDialog } from "./-create-dialog";

const ProjectCard = ({ project }: { project: ProjectItem }) => (
  <Link to="/projects/$projectId" params={{ projectId: project.id }} className="block">
    <Card className="hover:border-primary/50 transition-colors">
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
  </Link>
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
  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const [page, setPage] = useState(1);
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, page));

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
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.items.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
          {data.total > data.limit && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => {
                  setPage((prev) => prev - 1);
                }}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-sm">
                Page {data.page} of {Math.ceil(data.total / data.limit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page * data.limit >= data.total}
                onClick={() => {
                  setPage((prev) => prev + 1);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
