import type { BuildWithArtifact } from "@better-update/api";

import {
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../../components/attribute-badges";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { BuildRowActions } from "./-build-row-actions";

import type { DataTableColumnDef } from "../../../../../../lib/data-table";

export type BuildItem = BuildWithArtifact;

const buildLabel = (build: BuildItem) =>
  (build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`;

export const buildBuildsColumns = (
  orgId: string,
  projectId: string,
): readonly DataTableColumnDef<BuildItem>[] => [
  {
    id: "message",
    header: "Build",
    cell: ({ row }) => {
      const git =
        row.original.gitRef ?? (row.original.gitCommit ? row.original.gitCommit.slice(0, 7) : null);
      return (
        // No width cap of its own — the column is the primary one, so the cell
        // is as wide as the table has to spare and truncates against that.
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{buildLabel(row.original)}</span>
          <span className="text-kumo-subtle truncate font-mono text-xs">
            {git ? (
              <>
                {git}
                {row.original.gitDirty ? <span className="text-kumo-warning"> ·dirty</span> : null}
              </>
            ) : (
              (row.original.bundleId ?? `#${row.original.id.slice(0, 8)}`)
            )}
          </span>
        </div>
      );
    },
    enableSorting: false,
    meta: { primary: true },
  },
  {
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformIndicator platform={row.original.platform} />,
    enableSorting: true,
  },
  {
    id: "distribution",
    accessorKey: "distribution",
    header: "Distribution",
    cell: ({ row }) => <DistributionIndicator distribution={row.original.distribution} />,
    enableSorting: true,
  },
  {
    id: "runtimeVersion",
    accessorKey: "runtimeVersion",
    header: "Runtime",
    cell: ({ row }) =>
      row.original.runtimeVersion === null ? (
        <span className="text-kumo-subtle text-xs">—</span>
      ) : (
        <span className="font-mono text-xs">v{row.original.runtimeVersion}</span>
      ),
    enableSorting: true,
  },
  {
    id: "appVersion",
    accessorKey: "appVersion",
    header: "App version",
    cell: ({ row }) =>
      row.original.appVersion === null ? (
        <span className="text-kumo-subtle text-xs">—</span>
      ) : (
        <span className="font-mono text-xs">{row.original.appVersion}</span>
      ),
    enableSorting: true,
    enableHiding: true,
  },
  {
    id: "buildNumber",
    accessorKey: "buildNumber",
    header: "Build number",
    cell: ({ row }) =>
      row.original.buildNumber === null ? (
        <span className="text-kumo-subtle text-xs">—</span>
      ) : (
        <code className="font-mono text-xs">{row.original.buildNumber}</code>
      ),
    enableSorting: false,
    enableHiding: true,
  },
  {
    id: "size",
    header: "Size",
    cell: ({ row }) => (row.original.artifact ? formatBytes(row.original.artifact.byteSize) : "—"),
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
    cell: ({ row }) => <BuildRowActions build={row.original} orgId={orgId} projectId={projectId} />,
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];
