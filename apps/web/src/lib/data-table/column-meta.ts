import type { RowData } from "@tanstack/react-table";

export interface DataTableColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
  readonly stopRowClick?: boolean;
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
    muted?: boolean;
    stopRowClick?: boolean;
  }
}

export const cellAlignClass = (meta: DataTableColumnMeta | undefined): string => {
  const classes: string[] = [];
  if (meta?.align === "right") {
    classes.push("text-right tabular-nums");
  }
  if (meta?.muted) {
    classes.push("text-muted-foreground");
  }
  return classes.join(" ");
};
