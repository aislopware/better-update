import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { useMemo } from "react";
import { z } from "zod";

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
import { submissionColumns } from "./-submissions-columns";

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

  const table = useReactTable({
    data: tableData,
    columns: [...submissionColumns],
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
          description="Builds handed to App Store Connect or the Play Console. A row appears once its upload succeeds."
        />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={4} rows={4} />
        )}
      </div>
    );
  }

  if (data.total === 0 && !hasFilters) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Submissions"
          description="Builds handed to App Store Connect or the Play Console. A row appears once its upload succeeds."
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
        description="Builds handed to App Store Connect or the Play Console. A row appears once its upload succeeds."
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
        columnsCount={submissionColumns.length}
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
        renderRowLink={(submission, { className, children }) => (
          <Link
            to="/projects/$projectSlug/submissions/$submissionId"
            params={{ projectSlug, submissionId: submission.id }}
            className={className}
          >
            {children}
          </Link>
        )}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/submissions/")({
  validateSearch: zodValidator(submissionsSearchSchema),
  component: SubmissionsPage,
});
