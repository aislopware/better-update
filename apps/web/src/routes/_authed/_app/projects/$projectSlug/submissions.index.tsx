import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { useMemo } from "react";
import { z } from "zod";

import type { SubmissionItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  PlatformIndicator,
  SubmissionMetadataBadge,
} from "../../../../../components/attribute-badges";
import { CliCommandBlock } from "../../../../../components/cli-command-block";
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
  PAGE_SIZE,
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
          <span className="text-kumo-subtle truncate font-mono text-xs">
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
          className="text-kumo-subtle hover:text-kumo-default text-sm underline-offset-4 hover:underline"
        >
          View build →
        </Link>
      ) : (
        <span className="text-kumo-subtle">—</span>
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
  <Empty
    icon={<UploadSimpleIcon className="text-kumo-inactive size-10" />}
    title="No submissions yet"
    description="Submit from your app repo — builds are pushed to App Store Connect or Google Play and tracked here."
    contents={
      <CliCommandBlock
        commands={[
          "better-update submit --platform ios",
          "better-update submit --platform android",
        ]}
      />
    }
  />
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
        <PageHeader
          title="Submissions"
          description="Builds handed to the App Store and Play Console, and how each one landed."
        />
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
        <PageHeader
          title="Submissions"
          description="Builds handed to the App Store and Play Console, and how each one landed."
        />
        <SubmissionsEmpty />
      </div>
    );
  }

  const { safePage } = computePagination(data.total, page);

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Submissions"
        description="Builds handed to the App Store and Play Console, and how each one landed."
      />
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
        pagination={{
          page: safePage,
          perPage: PAGE_SIZE,
          totalCount: data.total,
          entity: pluralize(data.total, "submission"),
          isFiltered: hasFilters,
          onChange: onPageChange,
        }}
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
