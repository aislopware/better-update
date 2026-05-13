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
import { Frame } from "@better-update/ui/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { cn } from "@better-update/ui/lib/utils";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
  PauseIcon,
  PlayIcon,
  SatelliteIcon,
} from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import type { Channel } from "@better-update/api";
import type { BranchItem, ChannelSort, ChannelSortColumn } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { parseRolloutState } from "../-channel-rollout-state";
import { CreateChannelDialog } from "../-create-channel-dialog";
import { DeleteChannelDialog } from "../-delete-channel-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { invalidateChannels as invalidateChannelsHelper } from "../-update-helpers";
import { TableSkeleton } from "../../../../../../components/skeletons";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { pluralize } from "../../../../../../lib/pluralize";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

type ChannelItem = typeof Channel.Type;

const PAGE_SIZE = 50;

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMNS = ["name", "createdAt"] as const satisfies readonly ChannelSortColumn[];

const toSortColumn = (id: string): ChannelSortColumn | undefined =>
  SORT_COLUMNS.find((column) => column === id);

const toApiSort = (sorting: SortingState): ChannelSort | undefined => {
  const [first] = sorting;
  if (!first) {
    return undefined;
  }
  const column = toSortColumn(first.id);
  if (!column) {
    return undefined;
  }
  return first.desc ? `-${column}` : column;
};

const ARIA_SORT_MAP = { asc: "ascending", desc: "descending" } as const;
const toAriaSort = (direction: false | "asc" | "desc"): "ascending" | "descending" | "none" =>
  direction === false ? "none" : ARIA_SORT_MAP[direction];

const SortIcon = ({ direction }: { direction: false | "asc" | "desc" }) => {
  if (direction === "asc") {
    return <ArrowUpIcon strokeWidth={2} className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ArrowDownIcon strokeWidth={2} className="size-3.5" />;
  }
  return null;
};

const computePagination = (total: number, itemCount: number, page: number) => {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const fromIndex = itemCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIndex = (safePage - 1) * PAGE_SIZE + itemCount;
  return { totalPages, safePage, fromIndex, toIndex };
};

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

interface ColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
  readonly stopRowClick?: boolean;
}

const cellAlignClass = (meta: ColumnMeta | undefined): string => {
  const classes: string[] = [];
  if (meta?.align === "right") {
    classes.push("text-right tabular-nums");
  }
  if (meta?.muted) {
    classes.push("text-muted-foreground");
  }
  return classes.join(" ");
};

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
      disabled={togglePauseMutation.isPending}
      onClick={(event) => {
        event.stopPropagation();
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

interface PaginationControlsProps {
  readonly countLabel: string;
  readonly safePage: number;
  readonly totalPages: number;
  readonly isPlaceholderData: boolean;
  readonly onChange: (next: number) => void;
}

const PaginationControls = ({
  countLabel,
  safePage,
  totalPages,
  isPlaceholderData,
  onChange,
}: PaginationControlsProps) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage === 1 || isPlaceholderData}
        onClick={() => {
          onChange(safePage - 1);
        }}
        aria-label="Previous page"
      >
        <ChevronLeftIcon strokeWidth={2} />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage >= totalPages || isPlaceholderData}
        onClick={() => {
          onChange(safePage + 1);
        }}
        aria-label="Next page"
      >
        <ChevronRightIcon strokeWidth={2} />
      </Button>
    </div>
  </div>
);

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
  const navigate = useNavigate();

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [page, setPage] = useState(1);

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSorting((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next.length === 0 ? DEFAULT_SORTING : next.slice(0, 1);
    });
    setPage(1);
  };

  const apiSort = toApiSort(sorting);
  const { data, isPlaceholderData, isLoading } = useQuery({
    ...channelsQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: 100 }),
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
    onSortingChange: handleSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const createCta = useMemo(
    () => <CreateChannelDialog orgId={orgId} projectId={projectId} />,
    [orgId, projectId],
  );

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
      <Frame
        className={
          isPlaceholderData ? "opacity-60 transition-opacity" : "opacity-100 transition-opacity"
        }
      >
        <Table variant="card">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  const sortDir = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        meta?.align === "right" ? "text-right" : "",
                        canSort
                          ? "hover:text-foreground cursor-pointer transition-colors select-none"
                          : "",
                      )}
                      aria-sort={toAriaSort(sortDir)}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5",
                          meta?.align === "right" ? "justify-end" : "",
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort ? <SortIcon direction={sortDir} /> : null}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={async () => {
                  await navigate({
                    to: "/projects/$projectSlug/channels/$channelId",
                    params: { projectSlug, channelId: row.original.id },
                  });
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <TableCell key={cell.id} className={cellAlignClass(meta)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={columns.length}>
                <PaginationControls
                  countLabel={countLabel}
                  safePage={safePage}
                  totalPages={totalPages}
                  isPlaceholderData={isPlaceholderData}
                  onChange={setPage}
                />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
    </div>
  );
};

const ChannelsPage = () => (
  <Suspense fallback={<ChannelsSkeleton />}>
    <ChannelsContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/")({
  component: ChannelsPage,
});
