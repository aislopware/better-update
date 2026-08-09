import { Badge } from "@better-update/ui/components/badge";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { Select } from "@better-update/ui/components/select";
import { UserMinusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import type { ProjectMemberItem, ProjectMemberRoleValue } from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import {
  DataTableView,
  PAGE_SIZE,
  RowActionsMenu,
  useDataTable,
} from "../../../../../lib/data-table";
import { onPicked } from "../../../../../lib/form-utils";
import { pluralize } from "../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../lib/relative-time";

import type { DataTableColumnDef } from "../../../../../lib/data-table";
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

export const principalDisplayName = (row: ProjectMemberItem): string =>
  row.displayName ?? row.email ?? row.principalId;

// Name over address, and nothing in front of it: the disc that used to lead the
// cell was hashed from the very name beside it, so it repeated the one thing the
// column already said in the page's loudest ink. Same cell as the org Members
// table, for the same reason.
const NameCell = ({ row }: { row: ProjectMemberItem }) => {
  const name = principalDisplayName(row);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-medium">{name}</span>
      {row.email === null ? null : (
        <span className="text-kumo-subtle truncate text-xs">{row.email}</span>
      )}
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
    size="sm"
    className="w-36"
    aria-label={`Change role for ${principalDisplayName(row)}`}
    items={PROJECT_ROLE_LABELS}
    value={row.role}
    disabled={isPending}
    onValueChange={onPicked((next: ProjectMemberRoleValue) => {
      if (next !== row.role) {
        onRoleChange(row, next);
      }
    })}
  />
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
  <RowActionsMenu label="Project member actions" isPending={isPending}>
    <DropdownMenu.Item
      variant="danger"
      onClick={() => {
        onRemove({
          principalId: row.principalId,
          name: principalDisplayName(row),
        });
      }}
      icon={UserMinusIcon}
    >
      Remove from project
    </DropdownMenu.Item>
  </RowActionsMenu>
);

interface BuildColumnsParams {
  canManage: boolean;
  pendingPrincipalId: string | undefined;
  onRoleChange: (row: ProjectMemberItem, role: ProjectMemberRoleValue) => void;
  onRemove: (target: RemoveTarget) => void;
}

const buildColumns = (params: BuildColumnsParams): DataTableColumnDef<ProjectMemberItem>[] => [
  {
    id: "name",
    accessorFn: (row) => principalDisplayName(row).toLowerCase(),
    header: "Name",
    cell: ({ row }) => <NameCell row={row.original} />,
    enableSorting: true,
    meta: { primary: true },
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
        } satisfies DataTableColumnDef<ProjectMemberItem>,
      ]
    : []),
];

export const ProjectMembersTableView = ({
  items,
  canManage,
  pendingPrincipalId,
  sorting,
  onSortingChange,
  onRoleChange,
  onRemove,
}: {
  items: readonly ProjectMemberItem[];
  canManage: boolean;
  pendingPrincipalId?: string | undefined;
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

  const table = useDataTable({
    data: tableData,
    columns,
    state: { sorting },
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    onSortingChange,
    enableMultiSort: false,
    enableSortingRemoval: false,
  });

  // The footer counts what the table holds, filters included — the page
  // upstream no longer has to thread a label down for it.
  const rowCount = table.getPrePaginatedRowModel().rows.length;

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      pagination={{
        page: table.state.pagination.pageIndex + 1,
        perPage: PAGE_SIZE,
        totalCount: rowCount,
        entity: pluralize(rowCount, "member"),
        onChange: (next) => {
          table.setPageIndex(next - 1);
        },
      }}
    />
  );
};
