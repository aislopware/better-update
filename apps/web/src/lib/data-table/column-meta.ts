import type { RowData } from "@tanstack/react-table";

/**
 * Typed-cell presentation applied centrally by DataTableView (opt-in, additive).
 * `text`, `status`, and `link` are semantic markers only — the column's own
 * cell renderer stays in charge of their presentation (`date` cells keep the
 * RelativeTime convention; the type just standardizes the muted treatment).
 */
export type DataTableCellType = "text" | "id" | "date" | "numeric" | "status" | "link";

export interface DataTableColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
  readonly stopRowClick?: boolean;
  readonly cellType?: DataTableCellType;
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
    muted?: boolean;
    stopRowClick?: boolean;
    cellType?: DataTableCellType;
  }
}

const CELL_TYPE_CLASSES: Partial<Record<DataTableCellType, string>> = {
  id: "font-mono text-xs text-muted-foreground",
  date: "text-muted-foreground",
  numeric: "text-right tabular-nums",
};

/** Numeric cells right-align their header along with the cell. */
export const headerAlignsRight = (meta: DataTableColumnMeta | undefined): boolean =>
  meta?.align === "right" || meta?.cellType === "numeric";

export const cellAlignClass = (meta: DataTableColumnMeta | undefined): string =>
  [
    meta?.align === "right" ? "text-right tabular-nums" : undefined,
    meta?.muted ? "text-muted-foreground" : undefined,
    meta?.cellType === undefined ? undefined : CELL_TYPE_CLASSES[meta.cellType],
  ]
    .filter((entry) => entry !== undefined)
    .join(" ");
