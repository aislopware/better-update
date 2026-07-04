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

import { RelativeTime } from "../../../lib/relative-time";
import { EmptyDash } from "./-credential-cells";
import { PROJECT_ROLE_LABELS } from "./-invite-dialog";

// Robots are project-scoped (GITLAB-RBAC-SPEC §1b, v2): one robot = one
// project + one project role. Rows with a null project are legacy pre-v2
// robots — they no longer authenticate and exist only to be revoked from the
// CLI, so they carry a hint instead of a project name.
export const RobotAccountsTable = ({
  items,
  projectNamesById,
}: {
  items: readonly RobotAccountItem[];
  projectNamesById: ReadonlyMap<string, string>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Project</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Bearer</TableHead>
        <TableHead>Created</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((robot) => (
        <TableRow key={robot.id}>
          <TableCell className="font-medium">{robot.name}</TableCell>
          <TableCell>
            {robot.projectId === null ? (
              <Badge variant="outline" className="text-muted-foreground">
                Legacy — recreate from CLI
              </Badge>
            ) : (
              (projectNamesById.get(robot.projectId) ?? "Unknown project")
            )}
          </TableCell>
          <TableCell>
            {robot.role === null ? <EmptyDash /> : PROJECT_ROLE_LABELS[robot.role]}
          </TableCell>
          <TableCell className="text-muted-foreground font-mono text-xs">
            {robot.bearerStart === null ? "— not minted —" : `${robot.bearerStart}···`}
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={robot.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
