import { branchesInfiniteQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";

import { BranchCard } from "../-branch-card";
import { CreateBranchDialog } from "../-create-branch-dialog";

const BranchesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <GitBranchIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No branches yet</EmptyTitle>
      <EmptyDescription>Create your first branch to start managing deployments.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const BranchesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    branchesInfiniteQueryOptions(orgId, projectId),
  );
  const branches = data.pages.flatMap((page) => page.items);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateBranchDialog orgId={orgId} projectId={projectId} />
      </div>
      {branches.length === 0 ? (
        <BranchesEmptyState />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {branches.map((branch) => (
              <BranchCard key={branch.id} branch={branch} orgId={orgId} projectId={projectId} />
            ))}
          </div>
          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={async () => {
                  await fetchNextPage();
                }}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/branches/")({
  loader: async ({ context }) => {
    const projectId = context.project.id;
    await context.queryClient.ensureInfiniteQueryData(
      branchesInfiniteQueryOptions(context.activeOrg.id, projectId),
    );
  },
  component: BranchesPage,
});
