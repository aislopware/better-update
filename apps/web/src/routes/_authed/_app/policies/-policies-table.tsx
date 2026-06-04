import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";

import type { PolicyItem } from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import { DataTableView } from "../../../../lib/data-table";
import { buildPolicyColumns } from "./-policies-columns";

export const PoliciesTableView = ({
  orgId,
  policies,
  countLabel,
  sorting,
  onSortingChange,
}: {
  orgId: string;
  policies: readonly PolicyItem[];
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
}) => {
  const columns = useMemo(() => buildPolicyColumns(orgId), [orgId]);
  const tableData = useMemo(() => [...policies], [policies]);

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
