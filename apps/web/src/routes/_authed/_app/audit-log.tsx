import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { assertCapability } from "../../../lib/access";
import { fireAndForget } from "../../../lib/data-table";
import { AuditLogSkeleton, AuditLogView, auditLogSearchSchema } from "./-audit-log-view";

const AuditLogPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Review every action performed in this organization."
      />
      <Suspense fallback={<AuditLogSkeleton />}>
        <AuditLogView
          orgId={activeOrg.id}
          scopeLabel="your organization"
          search={search}
          onChangeSearch={(next) => {
            fireAndForget(navigate({ to: ".", search: next }));
          }}
        />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/audit-log")({
  validateSearch: zodValidator(auditLogSearchSchema),
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canViewAuditLog");
  },
  component: AuditLogPage,
});
