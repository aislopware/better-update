import { auditLogsQueryOptions } from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../../../components/page-header";
import { AuditLogView } from "./-audit-log-view";

const AuditLogPage = () => {
  const { activeOrg } = Route.useRouteContext();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Review every action performed in this organization."
      />
      <AuditLogView orgId={activeOrg.id} scopeLabel="your organization" />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/audit-log")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    await context.queryClient.ensureQueryData(auditLogsQueryOptions(orgId));
  },
  component: AuditLogPage,
});
