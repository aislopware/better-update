import { getApiError } from "@better-update/api-client";
import { deleteEnvVar } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@better-update/ui/components/ui/table";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { EnvVar } from "@better-update/api";

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
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const handleDelete = async () => {
    setIsDeleting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteEnvVar(envVar.id);
      toast.success(`Variable "${envVar.key}" deleted`);
      await queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "env-vars"],
      });
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsDeleting(false);
    }
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
              <Button variant="ghost" size="icon-sm" disabled={isDeleting}>
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditOpen(true);
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                Delete
              </DropdownMenuItem>
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
    </>
  );
};
