import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, EllipsisVerticalIcon } from "lucide-react";
import { useState } from "react";

import type { AppleTeamItem, DeviceClassValue, DeviceItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { TeamCell } from "../-credential-cells";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const toggleEnabled = useApiMutation({
    mutationFn: async () => updateDevice(device.id, { enabled: !device.enabled }),
    onSuccess: async () => {
      toastManager.add({
        title: device.enabled ? "Device disabled" : "Device enabled",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
    },
  });

  return (
    <>
      <Menu>
        <MenuTrigger render={actionsTrigger} />
        <MenuPopup align="end" className="w-40">
          <MenuItem
            onClick={() => {
              setRenameOpen(true);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            onClick={() => {
              toggleEnabled.mutate();
            }}
            disabled={toggleEnabled.isPending}
          >
            {device.enabled ? "Disable" : "Enable"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
      <RenameDeviceDialog
        orgId={orgId}
        device={device}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteDeviceDialog
        orgId={orgId}
        device={device}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
};

export const buildDeviceColumns = (
  orgId: string,
  teamsById: ReadonlyMap<string, AppleTeamItem>,
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
    cell: ({ row }) => {
      const teamId = row.original.appleTeamId;
      return <TeamCell team={teamId === null ? null : teamsById.get(teamId)} />;
    },
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
