import { channelsQueryOptions, pauseChannel, resumeChannel } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { GitBranchIcon, PauseIcon, PlayIcon, SatelliteIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { Channel } from "@better-update/api";
import type { ChannelSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { ChannelStatusBadge } from "../-channel-status-badge";
import { CreateChannelDialog } from "../-create-channel-dialog";
import { DeleteChannelDialog } from "../-delete-channel-dialog";
import { invalidateChannels as invalidateChannelsHelper } from "../-update-helpers";
import { PageHeader } from "../../../../../../components/page-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import { CopyableId } from "../../../../../../lib/copy-button";
import {
  DataTableToolbar,
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

type ChannelItem = Channel;

const SEARCH_DEBOUNCE_MS = 300;

const SORT_COLUMNS = ["name", "createdAt"] as const satisfies readonly ChannelSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const channelsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
});

const ChannelsEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SatelliteIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No channels yet</EmptyTitle>
        <EmptyDescription>
          Create your first channel to start distributing updates.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const PauseToggleButton = ({
  channel,
  orgId,
  projectId,
}: {
  channel: ChannelItem;
  orgId: string;
  projectId: string;
}) => {
  const queryClient = useQueryClient();
  const togglePauseMutation = useApiMutation({
    mutationFn: async () =>
      channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id),
    onSuccess: async () => {
      toast.success(channel.isPaused ? "Channel resumed" : "Channel paused");
      await invalidateChannelsHelper(queryClient, orgId, projectId);
    },
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground/70 hover:text-foreground"
      disabled={togglePauseMutation.isPending}
      onClick={() => {
        togglePauseMutation.mutate();
      }}
      aria-label={channel.isPaused ? "Resume channel" : "Pause channel"}
    >
      {togglePauseMutation.isPending && <Spinner />}
      {!togglePauseMutation.isPending &&
        (channel.isPaused ? <PlayIcon strokeWidth={2} /> : <PauseIcon strokeWidth={2} />)}
    </Button>
  );
};

const buildColumns = (orgId: string, projectId: string): readonly ColumnDef<ChannelItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Channel",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <SatelliteIcon strokeWidth={2} className="text-muted-foreground size-4" />
        {row.original.name}
        {row.original.isBuiltin ? (
          <Badge variant="outline" className="text-muted-foreground">
            Built-in
          </Badge>
        ) : null}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-3.5" />
        {row.original.branchName ?? <CopyableId value={row.original.branchId} label="Branch ID" />}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <ChannelStatusBadge channel={row.original} />,
    enableSorting: false,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <PauseToggleButton channel={row.original} orgId={orgId} projectId={projectId} />
        {row.original.isBuiltin ? null : (
          <DeleteChannelDialog channel={row.original} orgId={orgId} projectId={projectId} />
        )}
      </div>
    ),
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];

const ChannelsSkeleton = () => (
  <>
    <PageHeader size="sub" title="Channels" />
    <TableSkeleton columns={5} rows={5} />
  </>
);

const ChannelsContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const projectSlug = project.slug;
  const routeNavigate = Route.useNavigate();

  const { page, sort, query: urlQuery } = Route.useSearch();
  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate: routeNavigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: urlQuery,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        routeNavigate({
          to: ".",
          search: (prev) => ({ ...prev, query: value, page: 1 }),
          replace: true,
        }),
      );
    },
  });

  const handleReset = () => {
    handleSearchChange("");
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, query: "", page: 1 }),
      }),
    );
  };

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...channelsQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => buildColumns(orgId, projectId), [orgId, projectId]);
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const createCta = <CreateChannelDialog orgId={orgId} projectId={projectId} />;

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Channels" actions={createCta} />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={5} rows={5} />
        )}
      </div>
    );
  }

  const showsGlobalEmpty = data.total === 0 && urlQuery.length === 0 && searchDraft.length === 0;

  if (showsGlobalEmpty) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Channels" actions={createCta} />
        <ChannelsEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "channel")}${
    urlQuery ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader size="sub" title="Channels" actions={createCta} />
      <DataTableToolbar
        search={{
          value: searchDraft,
          onChange: handleSearchChange,
          placeholder: "Search channels…",
        }}
        isFiltered={urlQuery.length > 0 || searchDraft.length > 0}
        onReset={handleReset}
      />
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        emptyMessage="No channels match your search."
        onRowClick={async (channel) => {
          await routeNavigate({
            to: "/projects/$projectSlug/channels/$channelId",
            params: { projectSlug, channelId: channel.id },
          });
        }}
      />
    </div>
  );
};

const ChannelsPage = () => (
  <Suspense fallback={<ChannelsSkeleton />}>
    <ChannelsContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/")({
  validateSearch: zodValidator(channelsSearchSchema),
  component: ChannelsPage,
});
