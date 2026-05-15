import {
  deleteEnvVar,
  envVarsQueryKey,
  globalEnvVarsQueryKey,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { EllipsisVerticalIcon } from "lucide-react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { useApiMutation } from "../../../../lib/use-api-mutation";
import { EditEnvVarDialog } from "./-edit-env-var-dialog";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "warning"> = {
  plaintext: "secondary",
  sensitive: "warning",
};

const SCOPE_VARIANTS: Record<string, "secondary" | "info"> = {
  project: "secondary",
  global: "info",
};

const ENV_LABELS: Record<string, string> = {
  development: "Dev",
  preview: "Preview",
  production: "Prod",
};

const VisibilityBadge = ({ visibility }: { visibility: string }) => (
  <Badge variant={VISIBILITY_VARIANTS[visibility] ?? "secondary"}>{visibility}</Badge>
);

const ValueDisplay = ({ envVar }: { envVar: typeof EnvVar.Type }) => {
  if (envVar.visibility === "sensitive") {
    return <span className="text-muted-foreground font-mono">••••••</span>;
  }
  return <span className="max-w-xs truncate font-mono text-sm">{envVar.value}</span>;
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
        <TableCell className="font-mono text-sm font-medium">{envVar.key}</TableCell>
        <TableCell>
          <ValueDisplay envVar={envVar} />
        </TableCell>
        <TableCell>
          <VisibilityBadge visibility={envVar.visibility} />
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {envVar.environments.map((env) => (
              <Badge key={env} variant="secondary">
                {ENV_LABELS[env] ?? env}
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
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                <EllipsisVerticalIcon strokeWidth={2} />
              </DropdownMenuTrigger>
              <DropdownMenuPopup align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      setEditOpen(true);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setDeleteOpen(true);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuPopup>
            </DropdownMenu>
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
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteEnvVarMutation.isPending}
              onClick={handleDelete}
            >
              {deleteEnvVarMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
};
