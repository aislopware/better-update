import {
  branchesQueryOptions,
  buildsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { LayersIcon, PackageIcon, CloudUploadIcon } from "lucide-react";
import { Suspense, useMemo } from "react";

import type { PlatformValue } from "@better-update/api-client/react";

import { ProjectSubpageHeader } from "../-project-subpage-header";
import { PlatformBadge } from "../../../../../../components/attribute-badges";
import { DetailCardSkeleton, SummaryCardsSkeleton } from "../../../../../../components/skeletons";
import { DataTableView } from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";
import { buildBuildsColumns } from "../builds/-builds-columns";

const RUNTIME_PAGE_LIMIT = 25;

const RuntimeNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No data for this runtime version</EmptyTitle>
        <EmptyDescription>Nothing in this project references this runtime yet.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          render={<Link to="/projects/$projectSlug/runtimes" params={{ projectSlug }} />}
        >
          Back to runtimes
        </Button>
      </EmptyContent>
    </Empty>
  </Card>
);

const RuntimeSummaryCards = ({
  buildsCount,
  updatesCount,
  latestActivity,
}: {
  buildsCount: number;
  updatesCount: number;
  latestActivity: string | null;
}) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Builds</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-medium">
          {buildsCount} {pluralize(buildsCount, "build")}
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Updates</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-medium">
          {updatesCount} {pluralize(updatesCount, "update")}
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Latest activity</CardTitle>
      </CardHeader>
      <CardContent className="text-sm font-medium">
        <RelativeTime value={latestActivity} />
      </CardContent>
    </Card>
  </div>
);

const UpdateRow = ({
  update,
  branchName,
  projectSlug,
}: {
  update: {
    readonly id: string;
    readonly groupId: string;
    readonly platform: PlatformValue;
    readonly message: string;
    readonly branchId: string;
    readonly createdAt: string;
    readonly rolloutPercentage: number;
  };
  branchName: string | undefined;
  projectSlug: string;
}) => (
  <Link
    to="/projects/$projectSlug/updates/$updateId"
    params={{ projectSlug, updateId: update.id }}
    className="hover:bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 transition-colors"
  >
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">
        {update.message || `Update ${update.groupId.slice(0, 8)}`}
      </span>
      <PlatformBadge platform={update.platform} />
      {branchName ? (
        <span className="text-muted-foreground text-sm">{branchName}</span>
      ) : (
        <code className="text-muted-foreground font-mono text-xs" title={update.branchId}>
          {update.branchId.slice(0, 8)}
        </code>
      )}
      {update.rolloutPercentage < 100 ? (
        <Badge variant="secondary">Rollout {update.rolloutPercentage}%</Badge>
      ) : null}
    </div>
    <RelativeTime value={update.createdAt} className="text-muted-foreground text-xs" />
  </Link>
);

const RuntimeDetailContent = () => {
  const { version } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;

  const { data: buildsData } = useSuspenseQuery(
    buildsQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: RUNTIME_PAGE_LIMIT,
    }),
  );
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: DROPDOWN_FETCH_LIMIT,
    }),
  );
  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const branchNames = useMemo(
    () => new Map(branchesData.items.map((branch) => [branch.id, branch.name])),
    [branchesData.items],
  );

  const buildsCount = buildsData.total;
  const updatesCount = updatesData.total;
  const latestActivity = useMemo(() => {
    const buildTimes = buildsData.items.map((build) => build.createdAt);
    const updateTimes = updatesData.items.map((update) => update.createdAt);
    const candidates = [...buildTimes, ...updateTimes];
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((acc, value) => (value > acc ? value : acc));
  }, [buildsData.items, updatesData.items]);

  const buildColumns = useMemo(() => buildBuildsColumns(orgId, projectId), [orgId, projectId]);
  const buildsTableData = useMemo(() => [...buildsData.items], [buildsData.items]);
  const buildsTable = useReactTable({
    data: buildsTableData,
    columns: [...buildColumns],
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (buildsCount === 0 && updatesCount === 0) {
    return (
      <>
        <ProjectSubpageHeader title={`Runtime v${version}`} />
        <RuntimeNotFoundState projectSlug={projectSlug} />
      </>
    );
  }

  return (
    <>
      <ProjectSubpageHeader title={`Runtime v${version}`} />

      <RuntimeSummaryCards
        buildsCount={buildsCount}
        updatesCount={updatesCount}
        latestActivity={latestActivity}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageIcon strokeWidth={2} className="text-muted-foreground size-4" />
            Builds on this runtime
          </CardTitle>
          <CardDescription>
            {buildsCount === 0
              ? "No builds yet"
              : `${buildsCount} ${pluralize(buildsCount, "build")} on runtime v${version}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {buildsCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              Build a binary against this runtime to see it here.
            </p>
          ) : (
            <DataTableView
              table={buildsTable}
              columnsCount={buildColumns.length}
              isPlaceholderData={false}
              countLabel={`${buildsTableData.length} of ${buildsCount}`}
              safePage={1}
              totalPages={1}
              onPageChange={() => {
                /* single-page view; full pagination via Builds page */
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudUploadIcon strokeWidth={2} className="text-muted-foreground size-4" />
            Updates on this runtime
          </CardTitle>
          <CardDescription>
            {updatesCount === 0
              ? "No updates yet"
              : `${updatesCount} ${pluralize(updatesCount, "update")} published on runtime v${version}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {updatesCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              Publish an update with this runtime version to see it here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {updatesData.items.slice(0, 10).map((update) => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  branchName={branchNames.get(update.branchId)}
                  projectSlug={projectSlug}
                />
              ))}
              {updatesData.items.length > 10 ? (
                <Link
                  to="/projects/$projectSlug/updates"
                  params={{ projectSlug }}
                  search={{ page: 1, sort: "-createdAt" as const }}
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                  View all updates →
                </Link>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

const RuntimeDetailSkeleton = () => (
  <>
    <ProjectSubpageHeader title="Runtime" />
    <SummaryCardsSkeleton count={3} />
    <DetailCardSkeleton rows={3} columns={2} />
    <DetailCardSkeleton rows={3} columns={1} />
  </>
);

const RuntimeDetailPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<RuntimeDetailSkeleton />}>
      <RuntimeDetailContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/runtimes/$version")({
  component: RuntimeDetailPage,
});
