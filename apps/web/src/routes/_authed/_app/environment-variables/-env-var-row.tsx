import { Badge } from "@better-update/ui/components/ui/badge";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";

import type { EnvVar } from "@better-update/api";
import type { ReactNode } from "react";

import { CopyButton } from "../../../../lib/copy-button";
import { pluralize } from "../../../../lib/pluralize";
import { RelativeTime } from "../../../../lib/relative-time";
import { formatEnvironmentLabel } from "./-env-vars-labels";

const SCOPE_LABELS: Record<string, string> = {
  project: "Project",
  global: "Global",
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
      <div className="flex max-w-96 flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm font-medium">{envVar.key}</span>
          <CopyButton value={envVar.key} label="Key" />
        </div>
        {envVar.label || envVar.description ? (
          <span
            className="text-muted-foreground truncate text-xs"
            title={[envVar.label, envVar.description].filter(Boolean).join(" — ")}
          >
            {[envVar.label, envVar.description].filter(Boolean).join(" — ")}
          </span>
        ) : null}
      </div>
    </TableCell>
    <TableCell className="text-sm">{formatEnvironmentLabel(envVar.environment)}</TableCell>
    <TableCell>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {SCOPE_LABELS[envVar.scope] ?? envVar.scope}
        {envVar.overridesGlobal ? <Badge variant="warning">overrides global</Badge> : null}
      </div>
    </TableCell>
    <TableCell>
      {/* Sensitive is the exception worth color; plaintext is the quiet default.
          Both stay plain text so the column keeps one left edge. */}
      {envVar.visibility === "sensitive" ? (
        <span className="text-warning-foreground text-sm font-medium">Sensitive</span>
      ) : (
        <span className="text-muted-foreground text-sm">Plaintext</span>
      )}
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
