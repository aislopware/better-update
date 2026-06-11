import { Badge } from "@better-update/ui/components/ui/badge";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";

import type { EnvVar } from "@better-update/api";

import { CopyButton } from "../../../../lib/copy-button";
import { RelativeTime } from "../../../../lib/relative-time";
import { formatEnvironmentLabel } from "./-env-vars-labels";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "warning"> = {
  plaintext: "secondary",
  sensitive: "warning",
};

const SCOPE_VARIANTS: Record<string, "secondary" | "info"> = {
  project: "secondary",
  global: "info",
};

// Read-only: the value is end-to-end encrypted and only readable via the CLI.
// The dashboard shows public metadata (key, environment, scope, visibility, history depth).
export const EnvVarRow = ({ envVar }: { envVar: EnvVar }) => (
  <TableRow>
    <TableCell>
      <div className="flex items-center gap-1">
        <span className="font-mono text-sm font-medium">{envVar.key}</span>
        <CopyButton value={envVar.key} label="Key" />
      </div>
    </TableCell>
    <TableCell>
      <Badge variant="secondary">{formatEnvironmentLabel(envVar.environment)}</Badge>
    </TableCell>
    <TableCell>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={SCOPE_VARIANTS[envVar.scope] ?? "secondary"}>{envVar.scope}</Badge>
        {envVar.overridesGlobal ? <Badge variant="warning">overrides global</Badge> : null}
      </div>
    </TableCell>
    <TableCell>
      <Badge variant={VISIBILITY_VARIANTS[envVar.visibility] ?? "secondary"}>
        {envVar.visibility}
      </Badge>
    </TableCell>
    <TableCell className="text-muted-foreground text-sm">{envVar.revisionCount}</TableCell>
    <TableCell className="text-muted-foreground text-sm">
      <RelativeTime value={envVar.updatedAt} />
    </TableCell>
  </TableRow>
);
