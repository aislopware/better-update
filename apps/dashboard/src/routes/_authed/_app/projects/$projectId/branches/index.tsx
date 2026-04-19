import { branchesQueryOptions } from "@better-update/api-client/react";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";

import { BranchCard } from "../-branch-card";
import { CreateBranchDialog } from "../-create-branch-dialog";

const BranchesEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <GitBranchIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No branches yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first branch to start managing deployments.
      </p>
    </CardContent>
  </Card>
);

const BranchesPage = () => {
  const { projectId } = Route.useParams();
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateBranchDialog orgId={orgId} projectId={projectId} />
      </div>
      {branchesData.items.length === 0 ? (
        <BranchesEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {branchesData.items.map((branch) => (
            <BranchCard key={branch.id} branch={branch} orgId={orgId} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectId/branches/")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      branchesQueryOptions(context.activeOrg.id, params.projectId),
    );
  },
  component: BranchesPage,
});
