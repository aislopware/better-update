import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EllipsisVerticalIcon, UserMinusIcon } from "lucide-react";
import { useMemo } from "react";

import type { ProjectMemberItem, ProjectMemberRoleValue } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { DataTableView, PAGE_SIZE } from "../../../../../lib/data-table";
import { EntityAvatar } from "../../../../../lib/entity-avatar";
import { RelativeTime } from "../../../../../lib/relative-time";

import type { RemoveTarget } from "./-project-members-mutations";

// GitLab ladder order for the role sort (maintainer outranks developer etc.).
const PROJECT_ROLE_RANK: Record<ProjectMemberRoleValue, number> = {
  maintainer: 0,
  developer: 1,
  reporter: 2,
};

const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

const PROJECT_ROLE_VALUES = ["maintainer", "developer", "reporter"] as const;

export const principalDisplayName = (row: ProjectMemberItem): string =>
  row.displayName ?? row.email ?? row.principalId;

const NameCell = ({ row }: { row: ProjectMemberItem }) => {
  const name = principalDisplayName(row);
  return (
    <div className="flex items-center gap-3">
      <EntityAvatar name={name || "U"} className="size-9" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm leading-none font-medium">{name}</span>
        {row.email === null ? null : (
          <span className="text-muted-foreground truncate text-xs">{row.email}</span>
        )}
      </div>
    </div>
  );
};

const RoleSelect = ({
  row,
  isPending,
  onRoleChange,
}: {
  row: ProjectMemberItem;
  isPending: boolean;
  onRoleChange: (row: ProjectMemberItem, role: ProjectMemberRoleValue) => void;
}) => (
  <Select
    items={PROJECT_ROLE_LABELS}
    value={row.role}
    disabled={isPending}
    onValueChange={(next) => {
      if (next !== null && next !== row.role) {
        onRoleChange(row, next);
      }
    }}
  >
    <SelectTrigger className="w-36" aria-label={`Change role for ${principalDisplayName(row)}`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {PROJECT_ROLE_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {PROJECT_ROLE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

const RoleCell = ({
  row,
  canManage,
  isPending,
  onRoleChange,
}: {
  row: ProjectMemberItem;
  canManage: boolean;
  isPending: boolean;
  onRoleChange: (row: ProjectMemberItem, role: ProjectMemberRoleValue) => void;
}) => {
  // An org-wide ("all projects") membership is managed on the org Members
  // screen, not per project — the row here is read-only (the shown role is
  // already the max of the org-wide and any explicit role).
  if (row.allProjects) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="outline">{PROJECT_ROLE_LABELS[row.role]}</Badge>
        <Badge variant="secondary">All projects</Badge>
      </div>
    );
  }
  return canManage ? (
    <RoleSelect row={row} isPending={isPending} onRoleChange={onRoleChange} />
  ) : (
    <Badge variant="outline">{PROJECT_ROLE_LABELS[row.role]}</Badge>
  );
};

const RowActions = ({
  row,
  isPending,
  onRemove,
}: {
  row: ProjectMemberItem;
  isPending: boolean;
  onRemove: (target: RemoveTarget) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground/70 hover:text-foreground"
          disabled={isPending}
          aria-label="Project member actions"
        />
      }
    >
      {isPending ? <Spinner /> : <EllipsisVerticalIcon strokeWidth={2} />}
    </DropdownMenuTrigger>
    {/* w-auto: size to the labels, not the icon-button anchor width. */}
    <DropdownMenuContent align="end" className="w-auto">
      <DropdownMenuItem
        variant="destructive"
        onClick={() => {
          onRemove({
            principalId: row.principalId,
            name: principalDisplayName(row),
          });
        }}
      >
        <UserMinusIcon strokeWidth={2} />
        <span>Remove from project</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

interface BuildColumnsParams {
  canManage: boolean;
  pendingPrincipalId: string | undefined;
  onRoleChange: (row: ProjectMemberItem, role: ProjectMemberRoleValue) => void;
  onRemove: (target: RemoveTarget) => void;
}

const buildColumns = (params: BuildColumnsParams): ColumnDef<ProjectMemberItem>[] => [
  {
    id: "name",
    accessorFn: (row) => principalDisplayName(row).toLowerCase(),
    header: "Name",
    cell: ({ row }) => <NameCell row={row.original} />,
    enableSorting: true,
  },
  {
    id: "role",
    accessorFn: (row) => PROJECT_ROLE_RANK[row.role],
    header: "Role",
    cell: ({ row }) => {
      const { canManage, pendingPrincipalId, onRoleChange: handleRoleChange } = params;
      return (
        <RoleCell
          row={row.original}
          canManage={canManage}
          isPending={pendingPrincipalId === row.original.principalId}
          onRoleChange={handleRoleChange}
        />
      );
    },
    enableSorting: true,
  },
  {
    id: "addedAt",
    accessorFn: (row) => new Date(row.createdAt).getTime(),
    header: "Added",
    cell: ({ row }) => <RelativeTime value={new Date(row.original.createdAt)} />,
    enableSorting: true,
    meta: { align: "right" },
  },
  ...(params.canManage
    ? [
        {
          id: "actions",
          header: "",
          cell: ({ row }) => {
            const { pendingPrincipalId, onRemove: handleRemove } = params;
            // Org-wide memberships cannot be removed per project.
            if (row.original.allProjects) {
              return null;
            }
            return (
              <RowActions
                row={row.original}
                isPending={pendingPrincipalId === row.original.principalId}
                onRemove={handleRemove}
              />
            );
          },
          enableSorting: false,
          meta: { align: "right" },
        } satisfies ColumnDef<ProjectMemberItem>,
      ]
    : []),
];

export const ProjectMembersTableView = ({
  items,
  canManage,
  pendingPrincipalId,
  countLabel,
  sorting,
  onSortingChange,
  onRoleChange,
  onRemove,
}: {
  items: readonly ProjectMemberItem[];
  canManage: boolean;
  pendingPrincipalId?: string | undefined;
  countLabel?: string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
  onRoleChange: (row: ProjectMemberItem, role: ProjectMemberRoleValue) => void;
  onRemove: (target: RemoveTarget) => void;
}) => {
  const tableData = useMemo(() => [...items], [items]);
  const columns = useMemo(
    () => buildColumns({ canManage, pendingPrincipalId, onRoleChange, onRemove }),
    [canManage, pendingPrincipalId, onRoleChange, onRemove],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    onSortingChange,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      countLabel={countLabel}
      safePage={table.getState().pagination.pageIndex + 1}
      totalPages={Math.max(1, table.getPageCount())}
      onPageChange={(next) => {
        table.setPageIndex(next - 1);
      }}
    />
  );
};
