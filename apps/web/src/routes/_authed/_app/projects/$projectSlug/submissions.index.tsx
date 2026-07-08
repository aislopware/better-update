import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { UploadCloudIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { SubmissionItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  PlatformIndicator,
  SubmissionMetadataBadge,
} from "../../../../../components/attribute-badges";
import { PageHeader } from "../../../../../components/page-header";
import { QueryErrorState } from "../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../components/skeletons";
import {
  computePagination,
  DataTableFacetedFilter,
  DataTableToolbar,
  DataTableView,
  fireAndForget,
  enumArrayParam,
  pageParam,
} from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../lib/relative-time";

const PLATFORMS = ["ios", "android"] as const;
type PlatformFilter = (typeof PLATFORMS)[number];

const PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
] as const;

const isPlatform = (value: string | undefined): value is PlatformFilter =>
  value === "ios" || value === "android";

const submissionsSearchSchema = z.object({
  page: pageParam(),
  platform: enumArrayParam(PLATFORMS),
});

// "build" reads as jargon in a cell — spell out where the archive came from.
const ARCHIVE_SOURCE_LABELS: Record<string, string> = {
  build: "Uploaded build",
  url: "Archive URL",
};

const buildColumns = (projectSlug: string): readonly ColumnDef<SubmissionItem>[] => [
  {
    id: "profile",
    header: "Submission",
    cell: ({ row }) => (
      <div className="flex max-w-80 flex-col gap-0.5">
        <span className="truncate font-medium">{row.original.profileName}</span>
        {row.original.buildVersion ? (
          <span className="text-muted-foreground truncate font-mono text-xs">
            {row.original.buildVersion}
          </span>
        ) : null}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformIndicator platform={row.original.platform} />,
    enableSorting: false,
  },
  {
    id: "archiveSource",
    header: "Source",
    cell: ({ row }) =>
      ARCHIVE_SOURCE_LABELS[row.original.archiveSource] ?? row.original.archiveSource,
    enableSorting: false,
    meta: { muted: true },
  },
  {
    id: "build",
    header: "Build",
    cell: ({ row }) =>
      row.original.buildId ? (
        <Link
          to="/projects/$projectSlug/builds/$buildId"
          params={{ projectSlug, buildId: row.original.buildId }}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition-colors hover:underline"
        >
          View build →
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    enableSorting: false,
    meta: { stopRowClick: true },
  },
  {
    id: "metadata",
    header: "Metadata",
    cell: ({ row }) => <SubmissionMetadataBadge complete={row.original.metadataComplete} />,
    enableSorting: false,
  },
  {
    id: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];

const SubmissionsEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UploadCloudIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No submissions yet</EmptyTitle>
        <EmptyDescription>
          Use the CLI `better-update submit` to push a build to App Store Connect or Google Play.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const SubmissionsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { page, platform } = Route.useSearch();
  const hasFilters = platform.length > 0;
  // The API takes a single platform; both selected ≡ no filter.
  const platformParam = platform.length === 1 ? platform[0] : undefined;

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...submissionsQueryOptions(activeOrg.id, project.id, {
      page,
      ...(platformParam ? { platform: platformParam } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);
  const columns = useMemo(() => buildColumns(projectSlug), [projectSlug]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const setPlatformFilter = (next: readonly PlatformFilter[]): void => {
    fireAndForget(
      navigate({ to: ".", search: (prev) => ({ ...prev, platform: [...next], page: 1 }) }),
    );
  };

  const onPageChange = (nextPage: number): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, page: nextPage }) }));
  };

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Submissions" />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={6} rows={4} />
        )}
      </div>
    );
  }

  if (data.total === 0 && !hasFilters) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Submissions" />
        <SubmissionsEmpty />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "submission")}${
    hasFilters ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader size="sub" title="Submissions" />
      <DataTableToolbar
        isFiltered={hasFilters}
        onReset={() => {
          setPlatformFilter([]);
        }}
      >
        <DataTableFacetedFilter
          title="Platform"
          options={PLATFORM_OPTIONS}
          selected={platform}
          onChange={(next) => {
            setPlatformFilter(next.filter(isPlatform));
          }}
        />
      </DataTableToolbar>
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        emptyMessage="No submissions match the selected filters."
        onRowClick={(submission) => {
          fireAndForget(
            navigate({
              to: "/projects/$projectSlug/submissions/$submissionId",
              params: { projectSlug, submissionId: submission.id },
            }),
          );
        }}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/submissions/")({
  validateSearch: zodValidator(submissionsSearchSchema),
  component: SubmissionsPage,
});
