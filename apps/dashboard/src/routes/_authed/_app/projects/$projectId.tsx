import { projectQueryOptions } from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";

const ProjectShell = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();
  const { data: project } = useSuspenseQuery(projectQueryOptions(activeOrg.id, projectId));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex aspect-square size-10 items-center justify-center rounded-lg">
          <FolderIcon strokeWidth={2} className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground text-sm">{project.scopeKey}</p>
        </div>
      </div>
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      projectQueryOptions(context.activeOrg.id, params.projectId),
    );
  },
  component: ProjectShell,
});
