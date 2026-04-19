import { auditLogsQueryOptions } from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { AuditLogView } from "../../-audit-log-view";

const ProjectAuditLogPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return (
    <AuditLogView
      orgId={activeOrg.id}
      projectId={project.id}
      title="Audit Log"
      description="Track all actions performed in this project."
      scopeLabel="this project"
    />
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/audit-log")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    await context.queryClient.ensureQueryData(
      auditLogsQueryOptions(orgId, { projectId: context.project.id }),
    );
  },
  component: ProjectAuditLogPage,
});
