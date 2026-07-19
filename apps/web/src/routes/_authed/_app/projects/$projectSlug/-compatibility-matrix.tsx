import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { CircleCheckIcon } from "lucide-react";

import type {
  BuildCompatibilityMatrixResult,
  BuildWithArtifact,
  MissingRuntimeVersionBuild,
} from "@better-update/api";
import type { ReactNode } from "react";

import { PlatformIndicator } from "../../../../../components/attribute-badges";
import { pluralize } from "../../../../../lib/pluralize";
import { MissingMatchingBuilds } from "./-channel-compatibility";
import { synthesizeBuildChannels } from "./-compatibility-join";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

const buildLabel = (build: BuildWithSyntheticChannels) =>
  (build.message ?? build.profile) || build.id.slice(0, 8);

// Fixed-height glyph cell: the grid scans like a matrix, the words live in the
// tooltip. `label` doubles as the accessible name of the glyph.
const MatrixCellGlyph = ({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  children: ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <span aria-label={label} className="flex h-6 w-fit items-center gap-1.5 text-xs">
          {children}
        </span>
      }
    />
    <TooltipContent>{tooltip ?? label}</TooltipContent>
  </Tooltip>
);

const ServableTooltipBody = ({ channel }: { channel: SyntheticBuildChannel }) => (
  <span className="flex max-w-52 flex-col gap-0.5">
    <span>
      {channel.updateCount} {pluralize(channel.updateCount, "update")} servable
    </span>
    {channel.latestUpdateMessage ? (
      <span className="text-background/70 truncate">Latest: {channel.latestUpdateMessage}</span>
    ) : null}
    {channel.rolloutActive ? <span className="text-background/70">Rollout active</span> : null}
  </span>
);

const MatrixStatusCell = ({
  build,
  channel,
}: {
  build: BuildWithSyntheticChannels;
  channel: SyntheticBuildChannel;
}) => {
  if (channel.isPaused) {
    return (
      <MatrixCellGlyph label="Channel paused — updates are not served">
        <span className="bg-warning size-2 rounded-full" aria-hidden="true" />
      </MatrixCellGlyph>
    );
  }

  if (!build.runtimeVersion) {
    return (
      <MatrixCellGlyph label="No runtime version on this build">
        <span className="text-muted-foreground">—</span>
      </MatrixCellGlyph>
    );
  }

  // Only builds that DO receive updates get color — "no updates" is the quiet default.
  return channel.updateCount > 0 ? (
    <MatrixCellGlyph
      label={`${channel.updateCount} ${pluralize(channel.updateCount, "update")} servable`}
      tooltip={<ServableTooltipBody channel={channel} />}
    >
      <CircleCheckIcon strokeWidth={2} className="text-success size-3.5" aria-hidden="true" />
      <span className="font-medium tabular-nums">{channel.updateCount}</span>
    </MatrixCellGlyph>
  ) : (
    <MatrixCellGlyph label="No updates on this channel yet">
      <span className="bg-muted-foreground/40 size-2 rounded-full" aria-hidden="true" />
    </MatrixCellGlyph>
  );
};

const MatrixBuildRow = ({ build }: { build: BuildWithSyntheticChannels }) => (
  <TableRow key={build.id}>
    <TableCell>
      <div className="flex max-w-80 flex-col gap-0.5">
        <span className="truncate font-medium">{buildLabel(build)}</span>
        <span className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
          <PlatformIndicator platform={build.platform} className="gap-1" />
          {build.appVersion ? <span>App {build.appVersion}</span> : null}
          {build.buildNumber ? <span>#{build.buildNumber}</span> : null}
        </span>
      </div>
    </TableCell>
    <TableCell>
      {build.runtimeVersion ? (
        <span className="font-mono text-xs">v{build.runtimeVersion}</span>
      ) : (
        <Badge variant="warning">Missing</Badge>
      )}
    </TableCell>
    {build.channels.map((channel) => (
      <TableCell key={`${build.id}:${channel.channelId}`}>
        <MatrixStatusCell build={build} channel={channel} />
      </TableCell>
    ))}
  </TableRow>
);

// The matrix is a glanceable overview above the full builds table — cap its rows
// so a 50-build page doesn't push the actual list below the fold.
const MATRIX_ROW_LIMIT = 5;

export const CompatibilityMatrix = ({
  builds,
  matrix,
  missingRuntimeVersions,
}: {
  builds: readonly BuildWithArtifact[];
  matrix: typeof BuildCompatibilityMatrixResult.Type;
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => {
  const synthesized = builds
    .slice(0, MATRIX_ROW_LIMIT)
    .map((build) => synthesizeBuildChannels(build, matrix));
  const hiddenCount = builds.length - synthesized.length;
  const { channels } = matrix;

  if (synthesized.length === 0 && missingRuntimeVersions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} showChannel />

      {synthesized.length > 0 && channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Builds × channels</CardTitle>
            <CardDescription>
              Check which builds can receive OTA updates from each channel — hover a cell for
              details.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Build</TableHead>
                    <TableHead>Runtime</TableHead>
                    {channels.map((channel) => (
                      <TableHead key={channel.channelId}>{channel.channelName}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {synthesized.map((build) => (
                    <MatrixBuildRow key={build.id} build={build} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {hiddenCount > 0 && (
              <p className="text-muted-foreground text-xs">
                Showing the first {MATRIX_ROW_LIMIT} builds of the current view — {hiddenCount} more
                in the table below.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
