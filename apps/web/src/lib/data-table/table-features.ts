import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import type {
  Cell,
  ColumnDef,
  Header,
  Row,
  RowData,
  Table,
  TableOptions,
} from "@tanstack/react-table";

import type { DataTableColumnMeta } from "./column-meta";

/**
 * The one feature registry every list in the app is built on.
 *
 * v9 no longer bundles every feature into every table: what a table can do is
 * what its `features` object declares, and unregistered APIs are simply absent
 * at runtime. Declaring them once here — rather than per call site — keeps the
 * lists interchangeable, which is the whole premise of this module: a column
 * set written for one page works on any other.
 *
 * The three registered features are the three these lists actually use. Sorting
 * and pagination are client-side on the small lists and server-side on the
 * large ones (`manualSorting`), but both paths need the feature's state and
 * APIs. Column visibility backs `DataTableViewOptions`.
 */
export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  // `sortFn: 'auto'` (the default) picks by sampled value type and looks the
  // name up here; an unregistered name degrades to a basic compare and warns.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  // Per-table meta typing, which replaces v8's global `declare module`
  // augmentation — the meta belongs to these tables, not to every table in
  // every package that happens to import the library.
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Aliases so call sites name the row type only, as they did under v8. */
export type DataTableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData>;
export type DataTableInstance<TData extends RowData> = Table<DataTableFeatures, TData>;
export type DataTableHeader<TData extends RowData> = Header<DataTableFeatures, TData>;
export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>;
export type DataTableCell<TData extends RowData> = Cell<DataTableFeatures, TData>;

export type DataTableOptions<TData extends RowData> = Omit<
  TableOptions<DataTableFeatures, TData>,
  "features"
>;

/**
 * `useTable` with this module's features pre-bound.
 *
 * The core row model is implicit in v9 — there is no `getCoreRowModel()` to
 * pass — and the sorted/paginated models come from the registry above, so a
 * call site is left stating only what is particular to its list.
 */
export const useDataTable = <TData extends RowData>(options: DataTableOptions<TData>) =>
  useTable({ ...options, features: dataTableFeatures });
