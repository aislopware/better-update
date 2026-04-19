import { createUpdate } from "@better-update/api-client/react";
import { buildRollbackDirectiveBody } from "@better-update/expo-protocol";
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
import { useQueryClient } from "@tanstack/react-query";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import type { Update } from "@better-update/api";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateUpdates } from "./-update-helpers";

interface RollbackToEmbeddedDialogProps {
  readonly update: typeof Update.Type;
  readonly branchName: string;
  readonly slug: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export const RollbackToEmbeddedDialog = ({
  update,
  branchName,
  slug,
  orgId,
  projectId,
  open,
  onOpenChange,
}: RollbackToEmbeddedDialogProps) => {
  const queryClient = useQueryClient();
  const rollbackMutation = useApiMutation({
    mutationFn: async () =>
      createUpdate({
        branch: branchName,
        slug,
        runtimeVersion: update.runtimeVersion,
        platform: update.platform,
        message: "Rollback to embedded",
        groupId: crypto.randomUUID(),
        metadata: {},
        assets: [],
        isRollback: true,
        directiveBody: buildRollbackDirectiveBody(new Date().toISOString()),
      }),
    onSuccess: async () => {
      toast.success("Rollback directive created");
      await invalidateUpdates(queryClient, orgId, projectId);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rollback to embedded</DialogTitle>
          <DialogDescription>
            Publish a rollback directive so matching devices return to the update embedded in the
            app binary.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Target</span>
            <div className="flex items-center gap-2 text-sm">
              <span>{branchName}</span>
              <Badge variant="outline">{update.platform}</Badge>
              <span className="text-muted-foreground">v{update.runtimeVersion}</span>
            </div>
          </div>
          <p className="text-muted-foreground text-sm">
            This creates a new rollback directive entry on the branch. No assets will be uploaded.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              rollbackMutation.mutate();
            }}
            disabled={rollbackMutation.isPending}
          >
            <Undo2Icon strokeWidth={2} className="size-4" />
            {rollbackMutation.isPending ? "Creating..." : "Create rollback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
