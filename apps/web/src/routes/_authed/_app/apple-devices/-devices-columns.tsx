import { getApiError } from "@better-update/api-client";
import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, EllipsisVerticalIcon } from "lucide-react";

import type { DeviceClassValue, DeviceItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

export interface ColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
}

const CLASS_LABEL: Record<DeviceClassValue, string> = {
  IPHONE: "iPhone",
  IPAD: "iPad",
  MAC: "Mac",
  UNKNOWN: "Unknown",
};

const IdentifierCell = ({ identifier }: { identifier: string }) => {
  const { copied, copy } = useCopyToClipboard(1500);

  return (
    <div className="flex items-center gap-1.5">
      <code className="bg-muted max-w-[22ch] truncate rounded px-1.5 py-0.5 font-mono text-xs">
        {identifier}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy UDID"
        onClick={async () => {
          const ok = await copy(identifier);
          if (ok) {
            toastManager.add({ title: "UDID copied", type: "success" });
          }
        }}
      >
        {copied ? (
          <CheckIcon strokeWidth={2} className="size-3.5" />
        ) : (
          <CopyIcon strokeWidth={2} className="size-3.5" />
        )}
      </Button>
    </div>
  );
};

const actionsTrigger = (
  <Button variant="ghost" size="icon" aria-label="Device actions">
    <EllipsisVerticalIcon strokeWidth={2} />
  </Button>
);

const RowActions = ({ orgId, device }: { orgId: string; device: DeviceItem }) => {
  const queryClient = useQueryClient();
  const toggleEnabled = useMutation({
    mutationFn: async () => updateDevice(device.id, { enabled: !device.enabled }),
    onSuccess: async () => {
      toastManager.add({
        title: device.enabled ? "Device disabled" : "Device enabled",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
    },
    onError: (error) => {
      toastManager.add({ title: getApiError(error), type: "error" });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={actionsTrigger} />
      <DropdownMenuPopup align="end" className="w-40">
        <RenameDeviceDialog orgId={orgId} device={device}>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Rename
          </DropdownMenuItem>
        </RenameDeviceDialog>
        <DropdownMenuItem
          onSelect={() => {
            toggleEnabled.mutate();
          }}
          disabled={toggleEnabled.isPending}
        >
          {device.enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DeleteDeviceDialog orgId={orgId} device={device}>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Delete
          </DropdownMenuItem>
        </DeleteDeviceDialog>
      </DropdownMenuPopup>
    </DropdownMenu>
  );
};

export const buildDeviceColumns = (
  orgId: string,
  teamLabels: Record<string, string>,
): readonly ColumnDef<DeviceItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        {row.original.enabled ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        )}
        {row.original.name}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: "identifier",
    header: "UDID",
    cell: ({ row }) => <IdentifierCell identifier={row.original.identifier} />,
    enableSorting: false,
  },
  {
    id: "deviceClass",
    accessorKey: "deviceClass",
    header: "Class",
    cell: ({ row }) => <Badge variant="secondary">{CLASS_LABEL[row.original.deviceClass]}</Badge>,
    enableSorting: true,
  },
  {
    id: "team",
    header: "Team",
    cell: ({ row }) =>
      row.original.appleTeamId === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        <Badge variant="outline" className="font-mono text-xs">
          {teamLabels[row.original.appleTeamId] ?? row.original.appleTeamId.slice(0, 8)}
        </Badge>
      ),
    enableSorting: false,
  },
  {
    id: "model",
    header: "Model",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.model ?? "—"}</span>
    ),
    enableSorting: false,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Added",
    cell: ({ row }) => formatRelativeTime(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions orgId={orgId} device={row.original} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];
