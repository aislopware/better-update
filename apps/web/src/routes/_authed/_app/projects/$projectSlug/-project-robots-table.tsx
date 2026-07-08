import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { PROJECT_ROLE_LABELS } from "../../-invite-dialog";
import { CopyableId } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";

// Robots are project-scoped (GITLAB-RBAC-SPEC §1b, v2): one robot = one
// project + one project role, both fixed at creation. This table renders the
// robots of a single project, so no project column. The id is what every CLI
// robot command takes (`rotate`/`revoke`/`grant-env`), hence the copyable cell.
export const ProjectRobotsTable = ({ items }: { items: readonly RobotAccountItem[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Id</TableHead>
        <TableHead>Created</TableHead>
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
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
