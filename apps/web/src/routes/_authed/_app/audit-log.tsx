import { auditLogsQueryOptions } from "@better-update/api-client/react";
import { createFileRoute } from "@tanstack/react-router";

import { AuditLogView } from "./-audit-log-view";

const AuditLogPage = () => {
  const { activeOrg } = Route.useRouteContext();

  return <AuditLogView orgId={activeOrg.id} scopeLabel="your organization" />;
};

export const Route = createFileRoute("/_authed/_app/audit-log")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    await context.queryClient.ensureQueryData(auditLogsQueryOptions(orgId));
  },
  component: AuditLogPage,
});
