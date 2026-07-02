import { Badge } from "@better-update/ui/components/ui/badge";

import type { MemberAccessSummaryItem } from "@better-update/api-client/react";

// Compact chip summary of a member's effective access: org role plus the
// custom-policy count (direct + group-conferred).
export const AccessChips = ({ summary }: { summary: MemberAccessSummaryItem }) => (
  <div className="flex flex-wrap items-center gap-1">
    {summary.orgRole === "owner" ? <Badge variant="default">Owner</Badge> : null}
    {summary.orgRole === "admin" ? <Badge variant="default">Admin</Badge> : null}
    {summary.orgRole === "member" ? <Badge variant="outline">Member</Badge> : null}
    {summary.customPolicyCount > 0 ? (
      <Badge variant="outline">Custom ×{summary.customPolicyCount}</Badge>
    ) : null}
  </div>
);
