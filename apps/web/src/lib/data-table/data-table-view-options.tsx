import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { Settings2Icon } from "lucide-react";

import type { Table as ReactTableT } from "@tanstack/react-table";

/**
 * Column visibility toggle (shadcn data-table pattern). Only columns that
 * explicitly opt in with `enableHiding: true` are listed — pair with the Hide
 * item in DataTableColumnHeader so hidden columns stay recoverable.
 */
export const DataTableViewOptions = <TData,>({ table }: { table: ReactTableT<TData> }) => {
  const columns = table.getAllColumns().filter((column) => column.columnDef.enableHiding === true);
  if (columns.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger render={<Button variant="secondary" />}>
        <Settings2Icon strokeWidth={2} />
        View
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="w-44">
        <DropdownMenu.Group>
          <DropdownMenu.Label>Toggle columns</DropdownMenu.Label>
          <DropdownMenu.Separator />
          {columns.map((column) => (
            <DropdownMenu.CheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => {
                column.toggleVisibility(value);
              }}
            >
              {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};
