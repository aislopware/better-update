import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { SearchXIcon, UploadCloudIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { SubmissionItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { PlatformBadge, SubmissionMetadataBadge } from "../../../../../components/attribute-badges";
import { QueryErrorState } from "../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../components/skeletons";
import { CopyableId } from "../../../../../lib/copy-button";
import {
  computePagination,
  DataTableView,
  enumParam,
  fireAndForget,
  pageParam,
} from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../lib/relative-time";
import { ProjectSubpageHeader } from "./-project-subpage-header";

const PLATFORM_FILTER_VALUES = ["all", "ios", "android"] as const;
type PlatformFilter = (typeof PLATFORM_FILTER_VALUES)[number];

const PLATFORM_FILTER_LABELS: Record<PlatformFilter, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

const submissionsSearchSchema = z.object({
  page: pageParam(),
  platform: enumParam(PLATFORM_FILTER_VALUES, "all"),
});

const columns: readonly ColumnDef<SubmissionItem>[] = [
  {
    id: "profile",
    header: "Submission",
    cell: ({ row }) => <span className="truncate font-medium">{row.original.profileName}</span>,
    enableSorting: false,
  },
  {
    id: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
    enableSorting: false,
  },
  {
    id: "archiveSource",
    header: "Source",
    cell: ({ row }) => row.original.archiveSource,
    enableSorting: false,
    meta: { muted: true },
  },
  {
    id: "build",
    header: "Build",
    cell: ({ row }) =>
      row.original.buildId ? (
        <CopyableId value={row.original.buildId} label="Build ID" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    enableSorting: false,
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

const SubmissionsFilteredEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No submissions match the selected filters</EmptyTitle>
        <EmptyDescription>Try different filters or clear them.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const FilterSelect = <T extends string>({
  value,
  values,
  labels,
  ariaLabel,
  onChange,
}: {
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  ariaLabel: string;
  onChange: (next: T) => void;
}) => (
  <Select
    items={labels}
    value={value}
    onValueChange={(next) => {
      if (next !== null) {
        onChange(next);
      }
    }}
  >
    <SelectTrigger className="w-44" aria-label={ariaLabel}>
      <SelectValue />
    </SelectTrigger>
    <SelectPopup>
      <SelectGroup>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {labels[item]}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectPopup>
  </Select>
);

const SubmissionsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { page, platform } = Route.useSearch();
  const hasFilters = platform !== "all";

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...submissionsQueryOptions(activeOrg.id, project.id, {
      page,
      ...(platform === "all" ? {} : { platform }),
    }),
    placeholderData: keepPreviousData,
  });

  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const setFilter = (patch: Partial<{ platform: PlatformFilter }>): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, ...patch, page: 1 }) }));
  };

  const onPageChange = (nextPage: number): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, page: nextPage }) }));
  };

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ProjectSubpageHeader title="Submissions" />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={6} rows={4} />
        )}
      </div>
    );
  }

  const isEmpty = data.total === 0;
  const emptyState = hasFilters ? <SubmissionsFilteredEmpty /> : <SubmissionsEmpty />;
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
      <ProjectSubpageHeader title="Submissions" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={platform}
            values={PLATFORM_FILTER_VALUES}
            labels={PLATFORM_FILTER_LABELS}
            ariaLabel="Filter by platform"
            onChange={(next) => {
              setFilter({ platform: next });
            }}
          />
        </div>
        {isEmpty ? (
          emptyState
        ) : (
          <DataTableView
            table={table}
            columnsCount={columns.length}
            isPlaceholderData={isPlaceholderData}
            countLabel={countLabel}
            safePage={safePage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            onRowClick={(submission) => {
              fireAndForget(
                navigate({
                  to: "/projects/$projectSlug/submissions/$submissionId",
                  params: { projectSlug, submissionId: submission.id },
                }),
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/submissions/")({
  validateSearch: zodValidator(submissionsSearchSchema),
  component: SubmissionsPage,
});
