import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { AuditLogSkeleton, AuditLogView } from "../../-audit-log-view";

const ProjectAuditLogPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return (
    <Suspense fallback={<AuditLogSkeleton />}>
      <AuditLogView orgId={activeOrg.id} projectId={project.id} scopeLabel="this project" />
    </Suspense>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/audit-log")({
  component: ProjectAuditLogPage,
});
