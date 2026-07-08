import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { toast } from "@better-update/ui/components/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { EllipsisVerticalIcon } from "lucide-react";
import { useState } from "react";

import type { AppleTeamItem, DeviceClassValue, DeviceItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { TeamCell } from "../-credential-cells";
import { CopyButton } from "../../../../lib/copy-button";
import { RelativeTime } from "../../../../lib/relative-time";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

const CLASS_LABEL: Record<DeviceClassValue, string> = {
  IPHONE: "iPhone",
  IPAD: "iPad",
  MAC: "Mac",
  UNKNOWN: "Unknown",
};

const IdentifierCell = ({ identifier }: { identifier: string }) => (
  <div className="flex items-center gap-1.5">
    <code
      title={identifier}
      className="bg-muted max-w-[22ch] truncate rounded px-1.5 py-0.5 font-mono text-xs"
    >
      {identifier}
    </code>
    <CopyButton value={identifier} label="UDID" />
  </div>
);

// `appleDevicePortalId` is set once the UDID is registered on the Apple Developer
// Portal (via ASC), so its presence is the source of truth for "synced".
// "Not synced" is the default state — plain muted text; the synced
// confirmation is colored text (not a pill, so the column keeps one left edge).
const AppleSyncCell = ({ portalId }: { portalId: string | null }) =>
  portalId === null ? (
    <span className="text-muted-foreground text-sm">Not synced</span>
  ) : (
    <span className="text-success-foreground text-sm" title={`Apple device ID: ${portalId}`}>
      Synced
    </span>
  );

const actionsTrigger = (
  <Button
    variant="ghost"
    size="icon"
    className="text-muted-foreground/70 hover:text-foreground"
    aria-label="Device actions"
  >
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
      toast.success(device.enabled ? "Device disabled" : "Device enabled");
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={actionsTrigger} />
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={() => {
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              toggleEnabled.mutate();
            }}
            disabled={toggleEnabled.isPending}
          >
            {device.enabled ? "Disable" : "Enable"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    id: "appleSync",
    header: "Apple sync",
    cell: ({ row }) => <AppleSyncCell portalId={row.original.appleDevicePortalId} />,
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
    header: "Registered",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
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
