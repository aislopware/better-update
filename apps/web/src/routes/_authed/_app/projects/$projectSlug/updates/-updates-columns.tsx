import { Badge } from "@better-update/ui/components/ui/badge";

import type { Channel, Update } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { UpdateActionsMenu } from "../-update-actions-menu";
import { readUpdateEnvironment } from "../-update-helpers";
import { EnvironmentBadge, PlatformIndicator } from "../../../../../../components/attribute-badges";
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
        <div className="flex max-w-80 flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{row.original.message || "—"}</span>
            {row.original.isRollback ? <Badge variant="destructive">Rollback</Badge> : null}
            {typeof environment === "string" ? (
              <EnvironmentBadge environment={environment} />
            ) : null}
          </div>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {row.original.gitCommit ? (
              <>
                {row.original.gitCommit.slice(0, 7)}
                {row.original.gitDirty ? <span className="text-warning"> ·dirty</span> : null}
              </>
            ) : (
              `#${row.original.groupId.slice(0, 8)}`
            )}
          </span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => {
      const branchName = branchNames.get(row.original.branchId);
      return branchName === undefined ? (
        <CopyableId value={row.original.branchId} label="Branch ID" />
      ) : (
        <span className="block max-w-40 truncate" title={branchName}>
          {branchName}
        </span>
      );
    },
    enableSorting: false,
    enableHiding: true,
  },
  {
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformIndicator platform={row.original.platform} />,
    enableSorting: true,
  },
  {
    id: "runtimeVersion",
    accessorKey: "runtimeVersion",
    header: "Runtime",
    cell: ({ row }) => <span className="font-mono text-xs">v{row.original.runtimeVersion}</span>,
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
    enableHiding: true,
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
        <UpdateActionsMenu
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
    meta: { align: "right", stopRowClick: true },
  },
];
