import { projectBySlugQueryOptions } from "@better-update/api-client/react";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { Outlet, createFileRoute } from "@tanstack/react-router";

const ProjectShell = () => (
  <div className="flex w-full flex-col gap-4">
    <Outlet />
  </div>
);

const ProjectShellSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <Skeleton className="h-6 w-48 rounded" />
    <Skeleton className="h-48 w-full rounded-xl" />
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug")({
  beforeLoad: async ({ context, params }) => {
    const project = await context.queryClient.ensureQueryData(
      projectBySlugQueryOptions(context.activeOrg.id, params.projectSlug),
    );
    return { project };
  },
  pendingComponent: ProjectShellSkeleton,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ProjectShell,
});
