import { Badge } from "@better-update/ui/components/badge";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";

import type { RobotAccountItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { PROJECT_ROLE_LABELS } from "../../-invite-dialog";
import { CopyableId } from "../../../../../lib/copy-button";
import {
  clientPaginationFooter,
  DataTableView,
  RowActionsMenu,
  useClientPagination,
} from "../../../../../lib/data-table";
import { RelativeTime } from "../../../../../lib/relative-time";
import { EditRobotDialog } from "./-project-robot-edit-dialog";
import { useProjectRobotsHandlers } from "./-project-robots-mutations";

import type { ListPaginationFooter } from "../../../../../lib/data-table";
import type { EditTarget } from "./-project-robots-mutations";

const RowActions = ({
  robot,
  isPending,
  onEdit,
}: {
  robot: RobotAccountItem;
  isPending: boolean;
  onEdit: (target: EditTarget) => void;
}) => (
  <RowActionsMenu label="Robot account actions" isPending={isPending}>
    <DropdownMenu.Item
      onClick={() => {
        onEdit({ id: robot.id, name: robot.name, role: robot.role });
      }}
      icon={PencilSimpleIcon}
    >
      Edit
    </DropdownMenu.Item>
  </RowActionsMenu>
);

const robotColumns = (
  pendingRobotId: string | undefined,
  onEdit: (target: EditTarget) => void,
): readonly ColumnDef<RobotAccountItem>[] => [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => <span className="block truncate font-medium">{row.original.name}</span>,
    enableSorting: false,
    meta: { primary: true },
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) => <Badge variant="outline">{PROJECT_ROLE_LABELS[row.original.role]}</Badge>,
    enableSorting: false,
  },
  {
    id: "id",
    header: "Id",
    cell: ({ row }) => <CopyableId value={row.original.id} label="Robot ID" />,
    enableSorting: false,
    meta: { muted: true },
  },
  {
    id: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <RowActions
        robot={row.original}
        isPending={pendingRobotId === row.original.id}
        onEdit={onEdit}
      />
    ),
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];

// Robots are project-scoped (GITLAB-RBAC-SPEC §1b, v2): one robot = one
// project, fixed at creation, so no project column. Name and role are edited
// together through the row menu's Edit dialog — the page is maintainer-gated,
// and everyone who can see a robot here holds the rank the PATCH endpoint
// requires. The id is what the CLI robot commands take
// (`rotate`/`revoke`/`grant-env`), hence the copyable cell.
export const ProjectRobotsTableView = ({
  items,
  pendingRobotId,
  onEdit,
  pagination,
}: {
  items: readonly RobotAccountItem[];
  pendingRobotId?: string | undefined;
  onEdit: (target: EditTarget) => void;
  pagination?: ListPaginationFooter | undefined;
}) => {
  const columns = useMemo(() => robotColumns(pendingRobotId, onEdit), [pendingRobotId, onEdit]);
  const data = useMemo(() => [...items], [items]);
  const table = useReactTable({
    data,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  return <DataTableView table={table} columnsCount={columns.length} pagination={pagination} />;
};

/** The robots table wired to its mutations (the row menu's Edit dialog). */
export const ProjectRobotsTable = ({
  projectId,
  items,
}: {
  projectId: string;
  items: readonly RobotAccountItem[];
}) => {
  const handlers = useProjectRobotsHandlers(projectId);
  const pagination = useClientPagination(items, "robot account");

  return (
    <div className="flex flex-col gap-3">
      <ProjectRobotsTableView
        items={pagination.pageItems}
        pendingRobotId={handlers.isEditing ? handlers.editTarget?.id : undefined}
        onEdit={handlers.handleEditRequest}
        pagination={clientPaginationFooter(pagination)}
      />
      <EditRobotDialog
        target={handlers.editTarget}
        open={handlers.editOpen}
        isPending={handlers.isEditing}
        onOpenChange={handlers.handleEditOpenChange}
        onClosed={handlers.handleEditClosed}
        onSubmit={handlers.handleEditSubmit}
      />
    </div>
  );
};
