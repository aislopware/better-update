import {
  branchesQueryOptions,
  channelsQueryOptions,
  pauseChannel,
  resumeChannel,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { toastManager } from "@better-update/ui/components/ui/toast";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { GitBranchIcon, PauseIcon, PlayIcon, SatelliteIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { Channel } from "@better-update/api";
import type { BranchItem, ChannelSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { parseRolloutState } from "../-channel-rollout-state";
import { CreateChannelDialog } from "../-create-channel-dialog";
import { DeleteChannelDialog } from "../-delete-channel-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { invalidateChannels as invalidateChannelsHelper } from "../-update-helpers";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  pageParam,
  sortParam,
  useDataTableSearch,
} from "../../../../../../lib/data-table";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { pluralize } from "../../../../../../lib/pluralize";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";

type ChannelItem = Channel;

const SORT_COLUMNS = ["name", "createdAt"] as const satisfies readonly ChannelSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const channelsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
});

const ChannelsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SatelliteIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No channels yet</EmptyTitle>
      <EmptyDescription>Create your first channel to start distributing updates.</EmptyDescription>
    </EmptyHeader>
  </Empty>
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
      toastManager.add({
        title: channel.isPaused ? "Channel resumed" : "Channel paused",
        type: "success",
      });
      await invalidateChannelsHelper(queryClient, orgId, projectId);
    },
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      loading={togglePauseMutation.isPending}
      onClick={() => {
        togglePauseMutation.mutate();
      }}
      aria-label={channel.isPaused ? "Resume channel" : "Pause channel"}
    >
      {channel.isPaused ? <PlayIcon strokeWidth={2} /> : <PauseIcon strokeWidth={2} />}
    </Button>
  );
};

const ChannelStatusBadge = ({
  channel,
  branches,
}: {
  channel: ChannelItem;
  branches: readonly BranchItem[];
}) => {
  if (channel.isPaused) {
    return <Badge variant="warning">Paused</Badge>;
  }
  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;
  if (rolloutState) {
    const target = branches.find((branch) => branch.id === rolloutState.targetBranchId);
    return (
      <Badge variant="secondary">
        Rolling out to {target?.name ?? rolloutState.targetBranchId} {rolloutState.percentage}%
      </Badge>
    );
  }
  return <Badge variant="outline">Live</Badge>;
};

const buildColumns = (
  orgId: string,
  projectId: string,
  branches: readonly BranchItem[],
): readonly ColumnDef<ChannelItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Channel",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <SatelliteIcon strokeWidth={2} className="text-muted-foreground size-4" />
        {row.original.name}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => {
      const branch = branches.find((item) => item.id === row.original.branchId);
      return (
        <span className="inline-flex items-center gap-1.5">
          <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-3.5" />
          {branch?.name ?? row.original.branchId}
        </span>
      );
    },
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <ChannelStatusBadge channel={row.original} branches={branches} />,
    enableSorting: false,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatRelativeTime(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <PauseToggleButton channel={row.original} orgId={orgId} projectId={projectId} />
        <DeleteChannelDialog channel={row.original} orgId={orgId} projectId={projectId} />
      </div>
    ),
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];

const ChannelsSkeleton = () => (
  <>
    <div className="flex items-center justify-between">
      <ProjectSubpageHeader title="Channels" />
    </div>
    <TableSkeleton columns={5} rows={5} />
  </>
);

const ChannelsContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const projectSlug = project.slug;
  const routeNavigate = Route.useNavigate();

  const { page, sort } = Route.useSearch();
  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate: routeNavigate,
  });

  const { data, isPlaceholderData, isLoading } = useQuery({
    ...channelsQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const branches = branchesData.items;

  const columns = useMemo(
    () => buildColumns(orgId, projectId, branches),
    [orgId, projectId, branches],
  );
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
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Channels" />
          {createCta}
        </div>
        <TableSkeleton columns={5} rows={5} />
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Channels" />
          {createCta}
        </div>
        <ChannelsEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "channel")}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <ProjectSubpageHeader title="Channels" />
        {createCta}
      </div>
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
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
