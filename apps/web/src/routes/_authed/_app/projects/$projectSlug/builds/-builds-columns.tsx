import { Button } from "@better-update/ui/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { DownloadIcon } from "lucide-react";

import type { BuildWithArtifact } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { DeleteBuildDialog } from "../-delete-build-dialog";
import { InstallLinkDialog } from "../-install-link-dialog";
import { DistributionBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";

export type BuildItem = BuildWithArtifact;

const buildLabel = (build: BuildItem) =>
  (build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`;

const BuildActions = ({
  build,
  orgId,
  projectId,
}: {
  build: BuildItem;
  orgId: string;
  projectId: string;
}) => (
  <div className="flex items-center justify-end gap-1">
    {build.artifact ? (
      <>
        <InstallLinkDialog build={build} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Download artifact"
                render={
                  <a
                    aria-label="Download artifact"
                    href={`/api/builds/${build.id}/artifact`}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  />
                }
              />
            }
          >
            <DownloadIcon strokeWidth={2} />
          </TooltipTrigger>
          <TooltipPopup>Download artifact</TooltipPopup>
        </Tooltip>
      </>
    ) : null}
    <DeleteBuildDialog build={build} orgId={orgId} projectId={projectId} />
  </div>
);

export const buildBuildsColumns = (
  orgId: string,
  projectId: string,
): readonly ColumnDef<BuildItem>[] => [
  {
    id: "message",
    header: "Build",
    cell: ({ row }) => {
      const git =
        row.original.gitRef ?? (row.original.gitCommit ? row.original.gitCommit.slice(0, 7) : null);
      return (
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{buildLabel(row.original)}</span>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-xs">
            <code className="truncate">{row.original.id.slice(0, 8)}</code>
            {row.original.bundleId ? (
              <span className="truncate">{row.original.bundleId}</span>
            ) : null}
            {git ? (
              <span className="shrink-0">
                {git}
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
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
    enableSorting: true,
  },
  {
    id: "distribution",
    accessorKey: "distribution",
    header: "Distribution",
    cell: ({ row }) => <DistributionBadge distribution={row.original.distribution} />,
    enableSorting: true,
  },
  {
    id: "runtimeVersion",
    accessorKey: "runtimeVersion",
    header: "Runtime",
    cell: ({ row }) =>
      row.original.runtimeVersion === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        `v${row.original.runtimeVersion}`
      ),
    enableSorting: true,
  },
  {
    id: "appVersion",
    accessorKey: "appVersion",
    header: "App version",
    cell: ({ row }) =>
      row.original.appVersion === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        row.original.appVersion
      ),
    enableSorting: true,
  },
  {
    id: "buildNumber",
    accessorKey: "buildNumber",
    header: "Build number",
    cell: ({ row }) =>
      row.original.buildNumber === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        <code className="font-mono text-xs">{row.original.buildNumber}</code>
      ),
    enableSorting: false,
  },
  {
    id: "size",
    header: "Size",
    cell: ({ row }) => (row.original.artifact ? formatBytes(row.original.artifact.byteSize) : "—"),
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
    cell: ({ row }) => <BuildActions build={row.original} orgId={orgId} projectId={projectId} />,
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];
