import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { AuditLogSkeleton, AuditLogView } from "./-audit-log-view";

const AuditLogPage = () => {
  const { activeOrg } = Route.useRouteContext();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Review every action performed in this organization."
      />
      <Suspense fallback={<AuditLogSkeleton />}>
        <AuditLogView orgId={activeOrg.id} scopeLabel="your organization" />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/audit-log")({
  component: AuditLogPage,
});
