import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { toast } from "@better-update/ui/components/toast";
import { CheckCircleIcon, PencilSimpleIcon, ProhibitIcon, TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { AppleTeamItem, DeviceClassValue, DeviceItem } from "@better-update/api-client/react";

import { TeamNameCell } from "../-credential-cells";
import { StatusDot } from "../../../../components/status-dot";
import { CopyButton } from "../../../../lib/copy-button";
import { RowActionsMenu } from "../../../../lib/data-table";
import { RelativeTime } from "../../../../lib/relative-time";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

import type { DataTableColumnDef } from "../../../../lib/data-table";

const CLASS_LABEL: Record<DeviceClassValue, string> = {
  IPHONE: "iPhone",
  IPAD: "iPad",
  MAC: "Mac",
  UNKNOWN: "Unknown",
};

// What the device is sits under its name rather than in columns of its own: the
// hardware model and the class it belongs to said the same thing three times
// across the row, and only the model is specific enough to be worth the width.
// Class survives as a filter chip, and as the fallback when the model is unknown.
const NameCell = ({ device }: { device: DeviceItem }) => {
  // A device Apple never told us anything about has no second line: "Unknown"
  // under a name is a column admitting it has nothing to say.
  const detail =
    device.model ??
    (device.deviceClass === "UNKNOWN" ? undefined : CLASS_LABEL[device.deviceClass]);
  // Devices are usually named after themselves — "Diego's iPad Pro 13-inch (M4)"
  // over "iPad Pro 13-inch (M4)" printed the model twice, and the second copy
  // was the reason the first one truncated.
  const namesItself =
    detail !== undefined && device.name.toLowerCase().includes(detail.toLowerCase());
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {/* The badge follows the name rather than leading it: a disabled device
          pushed every name it preceded to a different left edge, and the column
          a reader scans down is the one that must not move. */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{device.name}</span>
        {device.enabled ? null : (
          <Badge variant="outline" className="text-kumo-subtle shrink-0">
            Disabled
          </Badge>
        )}
      </div>
      {namesItself || detail === undefined ? null : (
        <span className="text-kumo-subtle truncate text-xs">{detail}</span>
      )}
    </div>
  );
};

const IdentifierCell = ({ identifier }: { identifier: string }) => (
  <div className="flex items-center gap-1.5">
    <code
      title={identifier}
      className="bg-kumo-tint max-w-[22ch] truncate rounded px-1.5 py-0.5 font-mono text-xs"
    >
      {identifier}
    </code>
    <CopyButton value={identifier} label="UDID" />
  </div>
);

// `appleDevicePortalId` is set once the UDID is registered on the Apple Developer
// Portal (via ASC), so its presence is the source of truth for "synced". A dot
// rather than plain text: this is lifecycle state, and a column of grey
// sentences reads as filler where a column of dots reads as a health check.
// Colour marks the exception — a device left out of provisioning profiles;
// the healthy state gets the quiet dot, since nothing needs doing about it.
const AppleSyncCell = ({ portalId }: { portalId: string | null }) =>
  portalId === null ? (
    <StatusDot tone="warning">Not synced</StatusDot>
  ) : (
    <StatusDot tone="muted" className="text-kumo-subtle">
      <span title={`Apple device ID: ${portalId}`}>Synced</span>
    </StatusDot>
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
      <RowActionsMenu label="Device actions">
        <DropdownMenu.Item
          icon={PencilSimpleIcon}
          onClick={() => {
            setRenameOpen(true);
          }}
        >
          Rename device
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={device.enabled ? ProhibitIcon : CheckCircleIcon}
          onClick={() => {
            toggleEnabled.mutate();
          }}
          disabled={toggleEnabled.isPending}
        >
          {device.enabled ? "Disable device" : "Enable device"}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="danger"
          icon={TrashIcon}
          onClick={() => {
            setDeleteOpen(true);
          }}
        >
          Delete device
        </DropdownMenu.Item>
      </RowActionsMenu>
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
): readonly DataTableColumnDef<DeviceItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <NameCell device={row.original} />,
    enableSorting: true,
    meta: { primary: true },
  },
  {
    id: "identifier",
    header: "UDID",
    cell: ({ row }) => <IdentifierCell identifier={row.original.identifier} />,
    enableSorting: false,
  },
  {
    // The team's name, not the stacked cell the credentials tables use: a
    // device belongs to a team the way a file belongs to a folder, and spelling
    // out the type and the raw id on every row cost the Name column the width
    // it was truncating for.
    id: "team",
    header: "Team",
    cell: ({ row }) => {
      const teamId = row.original.appleTeamId;
      return <TeamNameCell team={teamId === null ? null : teamsById.get(teamId)} />;
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
