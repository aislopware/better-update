import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export const BranchesEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={GitBranchIcon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No branches yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first branch to start managing deployments.
      </p>
    </CardContent>
  </Card>
);
