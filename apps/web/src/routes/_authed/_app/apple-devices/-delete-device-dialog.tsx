import { deleteDevice, devicesQueryKey } from "@better-update/api-client/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@better-update/ui/components/ui/alert-dialog";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { DeviceItem } from "@better-update/api-client/react";
import type { ReactElement } from "react";

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
    <AlertDialog open={open} onOpenChange={setOpen}>
      {children ? <AlertDialogTrigger render={children} /> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove device?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="font-semibold">{device.name}</strong> will no longer be eligible for
            ad-hoc builds. You can re-register the UDID later if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            Remove device
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
