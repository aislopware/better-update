import { Badge } from "@better-update/ui/components/badge";
import { TableCell, TableRow } from "@better-update/ui/components/table";

import type { EnvVar } from "@better-update/api";
import type { ReactNode } from "react";

import { CopyButton } from "../../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS, ROW_ACTION_DISCLOSURE } from "../../../../lib/data-table";
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
  showScope = true,
  documentedAbove = false,
  hasActions = false,
  actions,
}: {
  envVar: EnvVar;
  /**
   * The row directly above is the same variable in another environment, so it
   * already carries the label and description. Those belong to the (scope, key)
   * pair rather than to any one row, and printing them again turns one
   * definition into three identical lines under three identical keys.
   */
  documentedAbove?: boolean;
  /**
   * Only a project's list mixes scopes. On the organization list every row is
   * global by definition, and a column that says the same word all the way down
   * is width spent on the page title.
   */
  showScope?: boolean;
  hasActions?: boolean;
  actions?: ReactNode;
}) => (
  // Same disclosure every other list gives its ⋮: at rest on a fine pointer the
  // trigger is invisible, and the row reveals it on hover or keyboard focus.
  <TableRow className={ROW_ACTION_DISCLOSURE}>
    {/* The key is what the row is: it takes the width the other columns leave
        and truncates inside the cell rather than pushing the table wider. */}
    <TableCell className={PRIMARY_COLUMN_CLASS}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm font-medium">{envVar.key}</span>
          <CopyButton value={envVar.key} label="Key" />
        </div>
        {!documentedAbove && (envVar.label || envVar.description) ? (
          <span
            className="text-kumo-subtle truncate text-xs"
            title={[envVar.label, envVar.description].filter(Boolean).join(" — ")}
          >
            {[envVar.label, envVar.description].filter(Boolean).join(" — ")}
          </span>
        ) : null}
      </div>
    </TableCell>
    <TableCell className="text-sm">{formatEnvironmentLabel(envVar.environment)}</TableCell>
    {showScope ? (
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {SCOPE_LABELS[envVar.scope] ?? envVar.scope}
          {envVar.overridesGlobal ? <Badge variant="warning">overrides global</Badge> : null}
        </div>
      </TableCell>
    ) : null}
    <TableCell>
      {/* Sensitive is the exception worth color; plaintext is the quiet default.
          Both stay plain text so the column keeps one left edge. */}
      {envVar.visibility === "sensitive" ? (
        <span className="text-kumo-warning text-sm font-medium">Sensitive</span>
      ) : (
        <span className="text-kumo-subtle text-sm">Plaintext</span>
      )}
    </TableCell>
    {/* The header already says what the number counts, so the cell is a number:
        repeating "revisions" down the column adds width without adding meaning. */}
    <TableCell className="text-kumo-subtle text-right text-sm tabular-nums">
      {envVar.revisionCount}
    </TableCell>
    <TableCell className="text-kumo-subtle text-sm">
      <RelativeTime value={envVar.updatedAt} />
    </TableCell>
    {hasActions ? <TableCell className="w-px text-right">{actions}</TableCell> : null}
  </TableRow>
);
