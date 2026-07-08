import { Button } from "@better-update/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { DownloadIcon } from "lucide-react";

import type { BuildWithArtifact } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { DeleteBuildDialog } from "../-delete-build-dialog";
import { InstallLinkDialog } from "../-install-link-dialog";
import {
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../../components/attribute-badges";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";

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
        <InstallLinkDialog
          build={build}
          buttonClassName="text-muted-foreground/70 hover:text-foreground"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground/70 hover:text-foreground"
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
          <TooltipContent>Download artifact</TooltipContent>
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
        <div className="flex max-w-96 flex-col gap-0.5">
          <span className="truncate font-medium">{buildLabel(row.original)}</span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {git ? (
              <>
                {git}
                {row.original.gitDirty ? <span className="text-warning"> ·dirty</span> : null}
              </>
            ) : (
              (row.original.bundleId ?? `#${row.original.id.slice(0, 8)}`)
            )}
          </span>
        </div>
      );
    },
    enableSorting: false,
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
        <span className="text-muted-foreground text-xs">—</span>
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
        <span className="text-muted-foreground text-xs">—</span>
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
        <span className="text-muted-foreground text-xs">—</span>
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
    cell: ({ row }) => <BuildActions build={row.original} orgId={orgId} projectId={projectId} />,
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];
