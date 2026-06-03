import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { CheckIcon, CopyIcon } from "lucide-react";

import type { EnvVar } from "@better-update/api";

import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { ENV_LABELS } from "./-env-vars-labels";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "warning"> = {
  plaintext: "secondary",
  sensitive: "warning",
};

const SCOPE_VARIANTS: Record<string, "secondary" | "info"> = {
  project: "secondary",
  global: "info",
};

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const { copied, copy } = useCopyToClipboard(1500);
  const handleCopy = async () => {
    const ok = await copy(value);
    toastManager.add(
      ok
        ? { title: `${label} copied`, type: "success" }
        : { title: "Failed to copy to clipboard", type: "error" },
    );
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={handleCopy}
    >
      {copied ? (
        <CheckIcon strokeWidth={2} className="size-3.5" />
      ) : (
        <CopyIcon strokeWidth={2} className="size-3.5" />
      )}
    </Button>
  );
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
      <Badge variant="secondary">{ENV_LABELS[envVar.environment]}</Badge>
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
  </TableRow>
);
