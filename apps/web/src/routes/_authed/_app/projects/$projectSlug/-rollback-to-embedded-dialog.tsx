import { createUpdate } from "@better-update/api-client/react";
import { buildRollbackDirectiveBody } from "@better-update/expo-protocol";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { Undo2Icon } from "lucide-react";

import type { Update } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateUpdates } from "./-update-helpers";

interface RollbackToEmbeddedDialogProps {
  readonly update: Update;
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
              <PlatformBadge platform={update.platform} />
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
            {rollbackMutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Undo2Icon strokeWidth={2} data-icon="inline-start" />
            )}
            Create rollback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
