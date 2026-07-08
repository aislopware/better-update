import { Button } from "@better-update/ui/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@better-update/ui/components/ui/menu";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { EllipsisVerticalIcon, PencilIcon } from "lucide-react";

import type { RobotAccountItem, RobotAccountRoleValue } from "@better-update/api-client/react";

import { PROJECT_ROLE_LABELS } from "../../-invite-dialog";
import { CopyableId } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";
import { RenameRobotDialog } from "./-project-robot-rename-dialog";
import { useProjectRobotsHandlers } from "./-project-robots-mutations";

import type { RenameTarget } from "./-project-robots-mutations";

const ROLE_VALUES = ["maintainer", "developer", "reporter"] as const;

const RoleSelect = ({
  robot,
  isPending,
  onRoleChange,
}: {
  robot: RobotAccountItem;
  isPending: boolean;
  onRoleChange: (robot: RobotAccountItem, role: RobotAccountRoleValue) => void;
}) => (
  <Select
    items={PROJECT_ROLE_LABELS}
    value={robot.role}
    disabled={isPending}
    onValueChange={(next) => {
      if (next !== null && next !== robot.role) {
        onRoleChange(robot, next);
      }
    }}
  >
    <SelectTrigger className="w-36" aria-label={`Change role for ${robot.name}`}>
      <SelectValue />
    </SelectTrigger>
    <SelectPopup>
      <SelectGroup>
        {ROLE_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {PROJECT_ROLE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectPopup>
  </Select>
);

const RowActions = ({
  robot,
  isPending,
  onRename,
}: {
  robot: RobotAccountItem;
  isPending: boolean;
  onRename: (target: RenameTarget) => void;
}) => (
  <Menu>
    <MenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon"
          loading={isPending}
          aria-label="Robot account actions"
        />
      }
    >
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuItem
        onClick={() => {
          onRename({ id: robot.id, name: robot.name });
        }}
      >
        <PencilIcon strokeWidth={2} />
        <span>Rename</span>
      </MenuItem>
    </MenuPopup>
  </Menu>
);

// Robots are project-scoped (GITLAB-RBAC-SPEC §1b, v2): one robot = one
// project, fixed at creation, so no project column. Name and role are editable
// in place — the page is maintainer-gated, and everyone who can see a robot
// here holds the rank the PATCH endpoint requires. The id is what the CLI
// robot commands take (`rotate`/`revoke`/`grant-env`), hence the copyable cell.
export const ProjectRobotsTableView = ({
  items,
  pendingRobotId,
  onRoleChange,
  onRename,
}: {
  items: readonly RobotAccountItem[];
  pendingRobotId?: string | undefined;
  onRoleChange: (robot: RobotAccountItem, role: RobotAccountRoleValue) => void;
  onRename: (target: RenameTarget) => void;
}) => (
  <Table variant="card">
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
            <RoleSelect
              robot={robot}
              isPending={pendingRobotId === robot.id}
              onRoleChange={onRoleChange}
            />
          </TableCell>
          <TableCell className="text-muted-foreground">
            <CopyableId value={robot.id} label="Robot ID" />
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={robot.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <RowActions robot={robot} isPending={pendingRobotId === robot.id} onRename={onRename} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** The robots table wired to its mutations (role select + rename dialog). */
export const ProjectRobotsTable = ({
  projectId,
  items,
}: {
  projectId: string;
  items: readonly RobotAccountItem[];
}) => {
  const handlers = useProjectRobotsHandlers(projectId);

  return (
    <>
      <ProjectRobotsTableView
        items={items}
        pendingRobotId={handlers.pendingRobotId}
        onRoleChange={handlers.handleRoleChange}
        onRename={handlers.handleRenameRequest}
      />
      <RenameRobotDialog
        target={handlers.renameTarget}
        open={handlers.renameOpen}
        isPending={handlers.isRenaming}
        onOpenChange={handlers.handleRenameOpenChange}
        onClosed={handlers.handleRenameClosed}
        onSubmit={handlers.handleRename}
      />
    </>
  );
};
