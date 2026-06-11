import { Badge } from "@better-update/ui/components/ui/badge";

import type { Channel, Update } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { UpdateActionButtons } from "../-update-action-buttons";
import { readUpdateEnvironment } from "../-update-helpers";
import { EnvironmentBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { CopyableId } from "../../../../../../lib/copy-button";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";

export type UpdateItem = Update;
export type ChannelItem = Channel;

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
              <EnvironmentBadge environment={environment} />
            ) : null}
          </div>
          <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
            <CopyableId value={row.original.groupId} label="Update group ID" />
            {row.original.gitCommit ? (
              <span className="shrink-0">
                {row.original.gitCommit.slice(0, 7)}
                {row.original.gitDirty ? <span className="text-warning"> ·dirty</span> : null}
              </span>
            ) : null}
          </div>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) =>
      branchNames.get(row.original.branchId) ?? (
        <CopyableId value={row.original.branchId} label="Branch ID" />
      ),
    enableSorting: false,
  },
  {
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
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
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
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
