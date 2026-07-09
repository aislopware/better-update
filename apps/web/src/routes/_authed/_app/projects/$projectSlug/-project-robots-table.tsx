import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { EllipsisVerticalIcon, PencilIcon } from "lucide-react";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { PROJECT_ROLE_LABELS } from "../../-invite-dialog";
import { CopyableId } from "../../../../../lib/copy-button";
import { ClientPaginationFooter, useClientPagination } from "../../../../../lib/data-table";
import { RelativeTime } from "../../../../../lib/relative-time";
import { EditRobotDialog } from "./-project-robot-edit-dialog";
import { useProjectRobotsHandlers } from "./-project-robots-mutations";

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
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground/70 hover:text-foreground"
          disabled={isPending}
          aria-label="Robot account actions"
        />
      }
    >
      {isPending ? <Spinner /> : <EllipsisVerticalIcon strokeWidth={2} />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onClick={() => {
          onEdit({ id: robot.id, name: robot.name, role: robot.role });
        }}
      >
        <PencilIcon strokeWidth={2} />
        <span>Edit</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

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
}: {
  items: readonly RobotAccountItem[];
  pendingRobotId?: string | undefined;
  onEdit: (target: EditTarget) => void;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Id</TableHead>
        <TableHead>Created</TableHead>
        <TableHead />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((robot) => (
        <TableRow key={robot.id}>
          <TableCell className="font-medium">{robot.name}</TableCell>
          <TableCell>
            <Badge variant="outline">{PROJECT_ROLE_LABELS[robot.role]}</Badge>
          </TableCell>
          <TableCell className="text-muted-foreground">
            <CopyableId value={robot.id} label="Robot ID" />
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={robot.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <RowActions robot={robot} isPending={pendingRobotId === robot.id} onEdit={onEdit} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

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
      <div className="overflow-hidden rounded-md border">
        <ProjectRobotsTableView
          items={pagination.pageItems}
          pendingRobotId={handlers.isEditing ? handlers.editTarget?.id : undefined}
          onEdit={handlers.handleEditRequest}
        />
      </div>
      <ClientPaginationFooter state={pagination} />
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
