import { Badge } from "@better-update/ui/components/ui/badge";

import type { Channel, Update } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { UpdateActionButtons } from "../-update-action-buttons";
import { readUpdateEnvironment } from "../-update-helpers";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";

export type UpdateItem = typeof Update.Type;
export type ChannelItem = typeof Channel.Type;

export const buildUpdateColumns = (
  branchNames: ReadonlyMap<string, string>,
  channels: readonly ChannelItem[],
  slug: string,
  orgId: string,
  projectId: string,
): readonly ColumnDef<UpdateItem>[] => [
  {
    id: "message",
    header: "Update",
    cell: ({ row }) => {
      const environment = readUpdateEnvironment(row.original.extraJson);
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{row.original.message || "—"}</span>
            {row.original.isRollback ? <Badge variant="destructive">Rollback</Badge> : null}
            {typeof environment === "string" ? (
              <Badge variant="secondary">{environment}</Badge>
            ) : null}
          </div>
          <code className="text-muted-foreground truncate font-mono text-xs">
            {row.original.groupId.slice(0, 8)}
          </code>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => branchNames.get(row.original.branchId) ?? row.original.branchId,
    enableSorting: false,
  },
  {
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <Badge variant="outline">{row.original.platform}</Badge>,
    enableSorting: true,
  },
  {
    id: "runtimeVersion",
    accessorKey: "runtimeVersion",
    header: "Runtime",
    cell: ({ row }) => `v${row.original.runtimeVersion}`,
    enableSorting: true,
  },
  {
    id: "rolloutPercentage",
    accessorKey: "rolloutPercentage",
    header: "Rollout",
    cell: ({ row }) => `${row.original.rolloutPercentage}%`,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "size",
    header: "Size",
    cell: ({ row }) =>
      row.original.totalAssetSize > 0 ? formatBytes(row.original.totalAssetSize) : "—",
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatRelativeTime(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UpdateActionButtons
          update={row.original}
          channels={channels}
          branchName={branchNames.get(row.original.branchId)}
          slug={slug}
          orgId={orgId}
          projectId={projectId}
        />
      </div>
    ),
    enableSorting: false,
    meta: { align: "right" },
  },
];
