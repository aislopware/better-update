import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
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

import type { SubmissionItem, SubmissionStatusValue } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { QueryErrorState } from "../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../components/skeletons";
import { CopyableId } from "../../../../../lib/copy-button";
import { DataTableView, enumParam, fireAndForget } from "../../../../../lib/data-table";
import { RelativeTime } from "../../../../../lib/relative-time";
import { ProjectSubpageHeader } from "./-project-subpage-header";

const STATUS_VARIANT: Record<SubmissionStatusValue, "secondary" | "destructive" | "outline"> = {
  AWAITING_BUILD: "outline",
  IN_QUEUE: "outline",
  IN_PROGRESS: "secondary",
  FINISHED: "secondary",
  ERRORED: "destructive",
  CANCELED: "outline",
};

const STATUS_LABEL: Record<SubmissionStatusValue, string> = {
  AWAITING_BUILD: "Awaiting build",
  IN_QUEUE: "In queue",
  IN_PROGRESS: "In progress",
  FINISHED: "Finished",
  ERRORED: "Errored",
  CANCELED: "Canceled",
};

const STATUS_VALUES = [
  "AWAITING_BUILD",
  "IN_QUEUE",
  "IN_PROGRESS",
  "FINISHED",
  "ERRORED",
  "CANCELED",
] as const satisfies readonly SubmissionStatusValue[];

const STATUS_FILTER_VALUES = ["all", ...STATUS_VALUES] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All statuses",
  ...STATUS_LABEL,
};

const PLATFORM_FILTER_VALUES = ["all", "ios", "android"] as const;
type PlatformFilter = (typeof PLATFORM_FILTER_VALUES)[number];

const PLATFORM_FILTER_LABELS: Record<PlatformFilter, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

const submissionsSearchSchema = z.object({
  status: enumParam(STATUS_FILTER_VALUES, "all"),
  platform: enumParam(PLATFORM_FILTER_VALUES, "all"),
});

const columns: readonly ColumnDef<SubmissionItem>[] = [
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status]}>
        {STATUS_LABEL[row.original.status]}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "profile",
    header: "Submission",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{row.original.profileName}</span>
        {row.original.status === "ERRORED" && row.original.errorMessage ? (
          <span className="text-destructive truncate text-xs">{row.original.errorMessage}</span>
        ) : null}
      </div>
    ),
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
  const { status, platform } = Route.useSearch();
  const hasFilters = status !== "all" || platform !== "all";

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...submissionsQueryOptions(activeOrg.id, project.id, {
      ...(status === "all" ? {} : { status }),
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

  const setFilter = (patch: Partial<{ status: StatusFilter; platform: PlatformFilter }>): void => {
    fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }) }));
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

  const isEmpty = data.items.length === 0;
  const emptyState = hasFilters ? <SubmissionsFilteredEmpty /> : <SubmissionsEmpty />;

  return (
    <div className="flex w-full flex-col gap-4">
      <ProjectSubpageHeader title="Submissions" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={status}
            values={STATUS_FILTER_VALUES}
            labels={STATUS_FILTER_LABELS}
            ariaLabel="Filter by status"
            onChange={(next) => {
              setFilter({ status: next });
            }}
          />
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
