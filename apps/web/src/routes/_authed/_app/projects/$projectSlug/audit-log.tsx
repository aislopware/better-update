import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense } from "react";

import { AuditLogSkeleton, AuditLogView, auditLogSearchSchema } from "../../-audit-log-view";
import { PageHeader } from "../../../../../components/page-header";
import { fireAndForget } from "../../../../../lib/data-table";

const ProjectAuditLogPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        size="sub"
        title="Audit log"
        description="Review every action performed in this project."
      />
      <Suspense fallback={<AuditLogSkeleton />}>
        <AuditLogView
          orgId={activeOrg.id}
          projectId={project.id}
          scopeLabel="this project"
          search={search}
          onChangeSearch={(next) => {
            fireAndForget(navigate({ to: ".", search: next }));
          }}
        />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/audit-log")({
  validateSearch: zodValidator(auditLogSearchSchema),
  component: ProjectAuditLogPage,
});
