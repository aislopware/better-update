import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { DownloadIcon } from "lucide-react";

import type { BuildWithArtifact } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { DISTRIBUTION_LABELS, FORMAT_LABELS } from "../-build-helpers";
import { DeleteBuildDialog } from "../-delete-build-dialog";
import { InstallLinkDialog } from "../-install-link-dialog";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";

export type BuildItem = typeof BuildWithArtifact.Type;

export interface ColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
}

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
        <a
          href={`/api/builds/${build.id}/artifact`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Button variant="ghost" size="icon" title="Download artifact">
            <DownloadIcon strokeWidth={2} />
          </Button>
        </a>
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
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="truncate font-medium">{buildLabel(row.original)}</span>
        <code className="text-muted-foreground truncate font-mono text-xs">
          {row.original.id.slice(0, 8)}
        </code>
      </div>
    ),
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
    id: "distribution",
    accessorKey: "distribution",
    header: "Distribution",
    cell: ({ row }) => (
      <Badge variant="secondary">{DISTRIBUTION_LABELS[row.original.distribution]}</Badge>
    ),
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
    id: "format",
    header: "Format",
    cell: ({ row }) =>
      row.original.artifact ? (
        <Badge variant="outline">{FORMAT_LABELS[row.original.artifact.format]}</Badge>
      ) : (
        <Badge variant="outline">No artifact</Badge>
      ),
    enableSorting: false,
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
    meta: { align: "right" },
  },
];
