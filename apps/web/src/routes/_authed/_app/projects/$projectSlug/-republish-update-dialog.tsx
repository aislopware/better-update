import { republishUpdate } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import type { Update } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateUpdates } from "./-update-helpers";

interface RepublishUpdateDialogProps {
  readonly update: Update;
  readonly branchName: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const RepublishForm = ({
  update,
  branchName,
  orgId,
  projectId,
  onSuccess,
}: {
  readonly update: Update;
  readonly branchName: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  const republishMutation = useApiMutation({
    mutationFn: async (message: string) =>
      republishUpdate({
        sourceGroupId: update.groupId,
        destinationBranchId: update.branchId,
        ...(message.trim().length > 0 ? { message: message.trim() } : {}),
      }),
    onSuccess: async () => {
      toastManager.add({ title: "Update republished", type: "success" });
      await invalidateUpdates(queryClient, orgId, projectId);
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { message: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(republishMutation.mutateAsync(value.message));
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <DialogPanel>
        <FieldGroup>
          <Field>
            <FieldLabel>Source update</FieldLabel>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{update.message || `Update ${update.groupId.slice(0, 8)}`}</span>
              <PlatformBadge platform={update.platform} />
              <span className="text-muted-foreground">v{update.runtimeVersion}</span>
              <span className="text-muted-foreground">on {branchName}</span>
            </div>
          </Field>

          <form.Field name="message">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="republish-message">Message (optional)</FieldLabel>
                <Textarea
                  id="republish-message"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  rows={3}
                  placeholder={`Republish of "${update.message}"`}
                />
              </Field>
            )}
          </form.Field>

          <p className="text-muted-foreground text-sm">
            Republishing creates a new update group on the same branch. Devices receive it as a
            fresh update — useful to reset a stalled rollout or re-issue after a rollback.
          </p>
        </FieldGroup>
      </DialogPanel>
      <DialogFooter>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" loading={isSubmitting}>
              <RefreshCwIcon strokeWidth={2} data-icon="inline-start" />
              Republish
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const RepublishUpdateDialog = ({
  update,
  branchName,
  orgId,
  projectId,
  open,
  onOpenChange,
}: RepublishUpdateDialogProps) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Republish update</DialogTitle>
          <DialogDescription>
            Publish this update again on the same branch to restart rollout.
          </DialogDescription>
        </DialogHeader>
        <RepublishForm
          key={resetKey}
          update={update}
          branchName={branchName}
          orgId={orgId}
          projectId={projectId}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
