import type { ColumnDef } from "@tanstack/react-table";

/**
 * Drops the columns a filter has already answered.
 *
 * A filter narrowed to a single value turns its column into the same word
 * repeated down the page, while the chip in the toolbar states that word once.
 * The width belongs to the columns that still vary — which matters most on the
 * way a reader usually arrives at a filtered list: from the thing it is
 * filtered by, already knowing which one it is.
 *
 * Keyed by column id, so a caller reads as the rule it is stating:
 * `withoutPinnedColumns(columns, { branch: branchIds.length === 1 })`.
 */
export const withoutPinnedColumns = <TData>(
  columns: readonly ColumnDef<TData>[],
  pinned: Readonly<Record<string, boolean>>,
): readonly ColumnDef<TData>[] =>
  columns.filter((column) => column.id === undefined || !pinned[column.id]);
