import {
  deleteEnvVar,
  envVarsQueryKey,
  globalEnvVarsQueryKey,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { useApiMutation } from "../../../../lib/use-api-mutation";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { EditEnvVarDialog } from "./-edit-env-var-dialog";
import { ENV_LABELS } from "./-env-vars-labels";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "warning"> = {
  plaintext: "secondary",
  sensitive: "warning",
};

const SCOPE_VARIANTS: Record<string, "secondary" | "info"> = {
  project: "secondary",
  global: "info",
};

const VisibilityBadge = ({ visibility }: { visibility: string }) => (
  <Badge variant={VISIBILITY_VARIANTS[visibility] ?? "secondary"}>{visibility}</Badge>
);

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const { copied, copy } = useCopyToClipboard(1500);
  const handleCopy = async () => {
    const ok = await copy(value);
    if (ok) {
      toastManager.add({ title: `${label} copied`, type: "success" });
    } else {
      toastManager.add({ title: "Failed to copy to clipboard", type: "error" });
    }
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

const KeyCell = ({ envKey }: { envKey: string }) => (
  <div className="flex items-center gap-1">
    <span className="font-mono text-sm font-medium">{envKey}</span>
    <CopyButton value={envKey} label="Key" />
  </div>
);

const ValueCell = ({ envVar }: { envVar: typeof EnvVar.Type }) => {
  const [revealed, setRevealed] = useState(false);
  const isSensitive = envVar.visibility === "sensitive";
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value is nullable at storage; UI renders empty placeholder when absent
  const value = envVar.value ?? "";
  const hasValue = value.length > 0;
  const showValue = !isSensitive || revealed;

  return (
    <div className="flex items-center gap-1">
      {showValue ? (
        <span className="max-w-xs truncate font-mono text-sm" title={value}>
          {hasValue ? value : <span className="text-muted-foreground italic">empty</span>}
        </span>
      ) : (
        <span className="text-muted-foreground font-mono">••••••</span>
      )}
      {isSensitive && hasValue ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={revealed ? "Hide value" : "Show value"}
          onClick={() => {
            setRevealed((prev) => !prev);
          }}
        >
          {revealed ? (
            <EyeOffIcon strokeWidth={2} className="size-3.5" />
          ) : (
            <EyeIcon strokeWidth={2} className="size-3.5" />
          )}
        </Button>
      ) : null}
      {hasValue ? <CopyButton value={value} label="Value" /> : null}
    </div>
  );
};

export const EnvVarRow = ({
  envVar,
  orgId,
  projectId,
  manageMode,
}: {
  envVar: typeof EnvVar.Type;
  orgId: string;
  projectId: string | undefined;
  manageMode: "all" | "scope-only";
}) => {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const deleteEnvVarMutation = useApiMutation({
    mutationFn: async () => deleteEnvVar(envVar.id),
    onSuccess: async () => {
      toastManager.add({ title: `Variable "${envVar.key}" deleted`, type: "success" });
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: envVarsQueryKey(orgId, projectId),
        });
      }
      await queryClient.invalidateQueries({ queryKey: globalEnvVarsQueryKey(orgId) });
      setDeleteOpen(false);
    },
  });

  const handleDelete = () => {
    deleteEnvVarMutation.mutate();
  };

  const isReadOnly = manageMode === "scope-only" && envVar.scope === "global";

  return (
    <>
      <TableRow>
        <TableCell>
          <KeyCell envKey={envVar.key} />
        </TableCell>
        <TableCell>
          <ValueCell envVar={envVar} />
        </TableCell>
        <TableCell>
          <VisibilityBadge visibility={envVar.visibility} />
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {envVar.environments.map((env) => (
              <Badge key={env} variant="secondary">
                {ENV_LABELS[env]}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={SCOPE_VARIANTS[envVar.scope] ?? "secondary"}>{envVar.scope}</Badge>
            {envVar.overridesGlobal ? <Badge variant="warning">overrides global</Badge> : null}
          </div>
        </TableCell>
        <TableCell className="text-right">
          {isReadOnly ? (
            <span className="text-muted-foreground text-xs">manage in org settings</span>
          ) : (
            <Menu>
              <MenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Variable actions" />}
              >
                <EllipsisVerticalIcon strokeWidth={2} />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuGroup>
                  <MenuItem
                    onClick={() => {
                      setEditOpen(true);
                    }}
                  >
                    Edit
                  </MenuItem>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuItem
                    variant="destructive"
                    onClick={() => {
                      setDeleteOpen(true);
                    }}
                  >
                    Delete
                  </MenuItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          )}
        </TableCell>
      </TableRow>
      {!isReadOnly && (
        <EditEnvVarDialog
          orgId={orgId}
          envVar={envVar}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete variable?</DialogTitle>
            <DialogDescription>
              This will permanently delete {envVar.key}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              loading={deleteEnvVarMutation.isPending}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
};
