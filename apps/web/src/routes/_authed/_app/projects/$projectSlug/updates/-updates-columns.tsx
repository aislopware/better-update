import { Badge } from "@better-update/ui/components/badge";

import type { Update } from "@better-update/api";

import { UpdateActionsMenu } from "../-update-actions-menu";
import { readUpdateEnvironment } from "../-update-helpers";
import { EnvironmentBadge, PlatformIndicator } from "../../../../../../components/attribute-badges";
import { CopyableId } from "../../../../../../lib/copy-button";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";

import type { DataTableColumnDef } from "../../../../../../lib/data-table";

export type UpdateItem = Update;

const FULL_ROLLOUT = 100;

export const buildUpdateColumns = (
  slug: string,
  orgId: string,
  projectId: string,
): readonly DataTableColumnDef<UpdateItem>[] => [
  {
    id: "message",
    header: "Update",
    cell: ({ row }) => {
      const environment = readUpdateEnvironment(row.original.extraJson);
      // An environment named after the branch it publishes from is the ordinary
      // case, and the branch is the next column along — the badge only earns its
      // place in the message's width when the two differ.
      const showEnvironment =
        typeof environment === "string" && environment !== row.original.branchName;
      return (
        // No width cap of its own — the column is the primary one, so the cell
        // is as wide as the table has to spare and truncates against that.
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{row.original.message || "—"}</span>
            {row.original.isRollback ? <Badge variant="error">Rollback</Badge> : null}
            {showEnvironment ? <EnvironmentBadge environment={environment} /> : null}
          </div>
          <span className="text-kumo-subtle truncate font-mono text-xs">
            {row.original.gitCommit ? (
              <>
                {row.original.gitCommit.slice(0, 7)}
                {row.original.gitDirty ? <span className="text-kumo-warning"> ·dirty</span> : null}
              </>
            ) : (
              `#${row.original.groupId.slice(0, 8)}`
            )}
          </span>
        </div>
      );
    },
    enableSorting: false,
    meta: { primary: true },
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => {
      const { branchName } = row.original;
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
    // A finished rollout is the ordinary end state and reads as filler down a
    // column; a partial one is the update someone is still watching, so it is
    // the only number that gets weight and colour.
    cell: ({ row }) =>
      row.original.rolloutPercentage >= FULL_ROLLOUT ? (
        <span className="text-kumo-subtle tabular-nums">100%</span>
      ) : (
        <span className="text-kumo-info font-medium tabular-nums">
          {row.original.rolloutPercentage}%
        </span>
      ),
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
          branchName={row.original.branchName}
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
