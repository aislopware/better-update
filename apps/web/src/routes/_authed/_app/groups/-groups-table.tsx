import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";

import type { GroupItem } from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import { DataTableView } from "../../../../lib/data-table";
import { buildGroupColumns } from "./-groups-columns";

export const GroupsTableView = ({
  orgId,
  groups,
  countLabel,
  sorting,
  onSortingChange,
}: {
  orgId: string;
  groups: readonly GroupItem[];
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
}) => {
  const columns = useMemo(() => buildGroupColumns(orgId), [orgId]);
  const tableData = useMemo(() => [...groups], [groups]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting },
    onSortingChange,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return <DataTableView table={table} columnsCount={columns.length} countLabel={countLabel} />;
};
