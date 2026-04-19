import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { GitBranchIcon } from "lucide-react";

import type { BranchItem } from "@better-update/api-client/react";

import { DeleteBranchDialog } from "./-delete-branch-dialog";
import { RenameBranchDialog } from "./-rename-branch-dialog";

export const BranchCard = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
}) => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-5" />
          <CardTitle className="text-base">{branch.name}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <RenameBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
          <DeleteBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <Badge variant="outline">{new Date(branch.createdAt).toLocaleDateString()}</Badge>
    </CardContent>
  </Card>
);
