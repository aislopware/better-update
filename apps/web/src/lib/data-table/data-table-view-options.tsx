import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
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
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Settings2Icon strokeWidth={2} />
        View
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => {
                column.toggleVisibility(value);
              }}
            >
              {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
