import { deleteDevice, devicesQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { DeviceItem } from "@better-update/api-client/react";
import type { ReactElement } from "react";

import { useApiMutation } from "../../../../lib/use-api-mutation";

export const DeleteDeviceDialog = ({
  orgId,
  device,
  children,
}: {
  orgId: string;
  device: DeviceItem;
  children: ReactElement;
}) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useApiMutation({
    mutationFn: async () => deleteDevice(device.id),
    onSuccess: async () => {
      toastManager.add({ title: "Device removed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Remove device?</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold">{device.name}</strong> will no longer be eligible for
            ad-hoc builds. You can re-register the UDID later if needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending ? "Removing..." : "Remove device"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
