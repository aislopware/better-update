import { projectBySlugQueryOptions } from "@better-update/api-client/react";
import { Outlet, createFileRoute } from "@tanstack/react-router";

const ProjectShell = () => (
  <div className="flex w-full flex-col gap-4">
    <Outlet />
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug")({
  beforeLoad: async ({ context, params }) => {
    const project = await context.queryClient.ensureQueryData(
      projectBySlugQueryOptions(context.activeOrg.id, params.projectSlug),
    );
    return { project };
  },
  component: ProjectShell,
});
