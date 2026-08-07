import { deleteDevice, devicesQueryKey } from "@better-update/api-client/react";
import { toast } from "@better-update/ui/components/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { DeviceItem } from "@better-update/api-client/react";
import type { ReactElement } from "react";

import { ConfirmDialog } from "../../../../components/confirm-dialog";
import { useApiMutation } from "../../../../lib/use-api-mutation";

export const DeleteDeviceDialog = ({
  orgId,
  device,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  orgId: string;
  device: DeviceItem;
  children?: ReactElement;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) => {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const queryClient = useQueryClient();

  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  const deleteMutation = useApiMutation({
    mutationFn: async () => deleteDevice(device.id),
    onSuccess: async () => {
      toast.success("Device removed");
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
      setOpen(false);
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={children}
      title="Remove device?"
      description={
        <>
          <strong className="text-kumo-default font-medium">{device.name}</strong> will no longer be
          eligible for ad-hoc builds. You can re-register the UDID later if needed.
        </>
      }
      confirmLabel="Remove device"
      isPending={deleteMutation.isPending}
      onConfirm={() => {
        deleteMutation.mutate();
      }}
    />
  );
};
