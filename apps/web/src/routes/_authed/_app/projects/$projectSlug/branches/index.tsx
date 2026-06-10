import { branchesQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { GitBranchIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { BranchItem, BranchSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { CreateBranchDialog } from "../-create-branch-dialog";
import { DeleteBranchDialog } from "../-delete-branch-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { RenameBranchDialog } from "../-rename-branch-dialog";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  pageParam,
  sortParam,
  useDataTableSearch,
} from "../../../../../../lib/data-table";
import { formatShortDate } from "../../../../../../lib/format-date";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { pluralize } from "../../../../../../lib/pluralize";

const SORT_COLUMNS = [
  "name",
  "createdAt",
  "updateCount",
] as const satisfies readonly BranchSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const branchesSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
});

const BranchesEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitBranchIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No branches yet</EmptyTitle>
        <EmptyDescription>Create your first branch to start managing deployments.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const BranchActions = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
}) =>
  branch.isBuiltin ? (
    <div className="flex items-center justify-end">
      <Badge variant="secondary">Built-in</Badge>
    </div>
  ) : (
    <div className="flex items-center justify-end gap-1">
      <RenameBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
      <DeleteBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
    </div>
  );

const buildColumns = (orgId: string, projectId: string): readonly ColumnDef<BranchItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Branch",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
        {row.original.name}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "updateCount",
    accessorKey: "updateCount",
    header: "Updates",
    cell: ({ row }) => row.original.updateCount,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span title={formatShortDate(row.original.createdAt)}>
        {formatRelativeTime(row.original.createdAt)}
      </span>
    ),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <BranchActions branch={row.original} orgId={orgId} projectId={projectId} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];

const BranchesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;

  const { page, sort } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...branchesQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
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

  const createCta = <CreateBranchDialog orgId={orgId} projectId={projectId} />;

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Branches" />
          {createCta}
        </div>
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={4} rows={5} />
        )}
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  if (data.total === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Branches" />
          {createCta}
        </div>
        <BranchesEmptyState />
      </div>
    );
  }

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "branch", "branches")}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <ProjectSubpageHeader title="Branches" />
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
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/branches/")({
  validateSearch: zodValidator(branchesSearchSchema),
  component: BranchesPage,
});
