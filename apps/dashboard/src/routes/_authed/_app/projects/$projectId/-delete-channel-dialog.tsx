import { getApiError } from "@better-update/api-client";
import { deleteChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel } from "@better-update/api";

export const DeleteChannelDialog = ({
  channel,
  orgId,
  projectId,
}: {
  channel: typeof Channel.Type;
  orgId: string;
  projectId: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmText("");
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteChannel(channel.id);
    } catch (error) {
      toast.error(getApiError(error));
      setIsDeleting(false);
      return;
    }
    setIsDeleting(false);
    toast.success("Channel deleted");
    await queryClient.invalidateQueries({
      queryKey: ["org", orgId, "projects", projectId, "channels"],
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="icon" className="size-8">
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="text-destructive size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {channel.name}?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. The channel will be permanently removed and clients will
            no longer receive updates through it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-4">
          <Label htmlFor="confirm-delete-channel">
            Type <span className="font-mono font-bold">{channel.name}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-channel"
            value={confirmText}
            onChange={(event) => {
              setConfirmText(event.target.value);
            }}
            placeholder={channel.name}
          />
        </div>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={confirmText !== channel.name || isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
