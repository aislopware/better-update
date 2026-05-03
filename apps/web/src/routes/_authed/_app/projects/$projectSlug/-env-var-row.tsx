import { deleteEnvVar, envVarsQueryKey } from "@better-update/api-client/react";
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

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { EditEnvVarDialog } from "./-edit-env-var-dialog";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "warning" | "error"> = {
  plaintext: "secondary",
  sensitive: "warning",
  secret: "error",
};

const VisibilityBadge = ({ visibility }: { visibility: string }) => (
  <Badge variant={VISIBILITY_VARIANTS[visibility] ?? "secondary"}>{visibility}</Badge>
);

const ValueDisplay = ({ envVar }: { envVar: typeof EnvVar.Type }) => {
  if (envVar.visibility === "secret") {
    return <span className="text-muted-foreground italic">hidden</span>;
  }
  if (envVar.visibility === "sensitive") {
    return <span className="text-muted-foreground font-mono">••••••</span>;
  }
  return <span className="max-w-xs truncate font-mono text-sm">{envVar.value}</span>;
};

export const EnvVarRow = ({
  envVar,
  orgId,
  projectId,
}: {
  envVar: typeof EnvVar.Type;
  orgId: string;
  projectId: string;
}) => {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const deleteEnvVarMutation = useApiMutation({
    mutationFn: async () => deleteEnvVar(envVar.id),
    onSuccess: async () => {
      toastManager.add({ title: `Variable "${envVar.key}" deleted`, type: "success" });
      await queryClient.invalidateQueries({
        queryKey: envVarsQueryKey(orgId, projectId),
      });
      setDeleteOpen(false);
    },
  });

  const handleDelete = () => {
    deleteEnvVarMutation.mutate();
  };

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
        <TableCell className="text-right">
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
        </TableCell>
      </TableRow>
      <EditEnvVarDialog
        orgId={orgId}
        projectId={projectId}
        envVar={envVar}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
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
