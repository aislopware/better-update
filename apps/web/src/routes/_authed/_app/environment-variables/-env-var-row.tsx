import { Badge } from "@better-update/ui/components/ui/badge";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";

import type { EnvVar } from "@better-update/api";
import type { ReactNode } from "react";

import { CopyButton } from "../../../../lib/copy-button";
import { pluralize } from "../../../../lib/pluralize";
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

// The value is end-to-end encrypted. Everywhere except the dedicated vault origin
// the dashboard shows public metadata only (key, environment, scope, visibility,
// history depth). On the vault origin, an unlocked vault adds the `actions` cell
// (reveal / edit / delete); `hasActions` keeps the column count aligned with the
// header even while the vault is locked (the cell renders empty).
export const EnvVarRow = ({
  envVar,
  hasActions = false,
  actions,
}: {
  envVar: EnvVar;
  hasActions?: boolean;
  actions?: ReactNode;
}) => (
  <TableRow>
    <TableCell>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm font-medium">{envVar.key}</span>
          <CopyButton value={envVar.key} label="Key" />
        </div>
        {envVar.label ? (
          <span className="max-w-md text-sm font-medium break-words">{envVar.label}</span>
        ) : null}
        {envVar.description ? (
          <p className="text-muted-foreground max-w-md text-xs break-words whitespace-normal">
            {envVar.description}
          </p>
        ) : null}
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
    <TableCell className="text-muted-foreground text-sm">
      {envVar.revisionCount} {pluralize(envVar.revisionCount, "revision")}
    </TableCell>
    <TableCell className="text-muted-foreground text-sm">
      <RelativeTime value={envVar.updatedAt} />
    </TableCell>
    {hasActions ? <TableCell className="w-px text-right">{actions}</TableCell> : null}
  </TableRow>
);
