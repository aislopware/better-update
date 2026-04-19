import { deleteEnvVar, envVarsQueryKey } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { EllipsisVerticalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { EnvVar } from "@better-update/api";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { EditEnvVarDialog } from "./-edit-env-var-dialog";

const VISIBILITY_VARIANTS: Record<string, "secondary" | "outline" | "destructive"> = {
  plaintext: "secondary",
  sensitive: "outline",
  secret: "destructive",
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
      toast.success(`Variable "${envVar.key}" deleted`);
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
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm">
                <EllipsisVerticalIcon strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
                  className="text-destructive"
                  onClick={() => {
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
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
        <DialogContent>
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
        </DialogContent>
      </Dialog>
    </>
  );
};
