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
  /** The column that absorbs the table's leftover width. At most one per table. */
  readonly primary?: boolean;
}

const CELL_TYPE_CLASSES: Partial<Record<DataTableCellType, string>> = {
  id: "font-mono text-xs text-kumo-subtle",
  date: "text-kumo-subtle",
  numeric: "text-right tabular-nums",
};

/** Numeric cells right-align their header along with the cell. */
export const headerAlignsRight = (meta: DataTableColumnMeta | undefined): boolean =>
  meta?.align === "right" || meta?.cellType === "numeric";

/**
 * Auto table layout gives every column the width its content asks for, which
 * means the column that matters most — the name, the release message — is the
 * one that loses: it truncates at a couple of dozen characters while a date
 * column two along sits on slack it has no use for. `w-full` claims the leftover
 * width for the primary column, and `max-w-0` drops its minimum contribution to
 * nothing so the truncation happens inside the cell rather than by pushing the
 * whole table wider than its frame.
 */
export const PRIMARY_COLUMN_CLASS = "w-full max-w-0";

export const columnWidthClass = (meta: DataTableColumnMeta | undefined): string | undefined =>
  meta?.primary ? PRIMARY_COLUMN_CLASS : undefined;

export const cellAlignClass = (meta: DataTableColumnMeta | undefined): string =>
  [
    meta?.align === "right" ? "text-right tabular-nums" : undefined,
    meta?.muted ? "text-kumo-subtle" : undefined,
    meta?.cellType === undefined ? undefined : CELL_TYPE_CLASSES[meta.cellType],
  ]
    .filter((entry) => entry !== undefined)
    .join(" ");
