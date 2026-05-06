import { createFileRoute } from "@tanstack/react-router";

import { AuditLogView } from "../../-audit-log-view";

const ProjectAuditLogPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <AuditLogView orgId={activeOrg.id} projectId={project.id} scopeLabel="this project" />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/audit-log")({
  component: ProjectAuditLogPage,
});
