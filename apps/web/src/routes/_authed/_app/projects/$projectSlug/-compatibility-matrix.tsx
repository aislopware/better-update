import { Badge } from "@better-update/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { Tooltip } from "@better-update/ui/components/tooltip";
import { cn } from "@better-update/ui/lib/utils";
import { CheckCircleIcon } from "@phosphor-icons/react";

import type {
  BuildCompatibilityMatrixResult,
  BuildWithArtifact,
  MissingRuntimeVersionBuild,
} from "@better-update/api";
import type { ReactNode } from "react";

import { PlatformIndicator } from "../../../../../components/attribute-badges";
import { TablePanel } from "../../../../../components/table-panel";
import { PRIMARY_COLUMN_CLASS } from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { MissingMatchingBuilds } from "./-channel-compatibility";
import { synthesizeBuildChannels } from "./-compatibility-join";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

const buildLabel = (build: BuildWithSyntheticChannels) =>
  (build.message ?? build.profile) || build.id.slice(0, 8);

// Fixed-height glyph cell: the grid scans like a matrix, the words live in the
// tooltip. `label` doubles as the accessible name of the glyph.
//
// The label used to be an `aria-label` on the span, where it was discarded: a
// plain span has no role that can carry a name, so the cell was read out as the
// bare number it draws — "3", with nothing to say three of what. (The tests
// could not see this; `getByLabelText` matches the attribute wherever it is
// written, not where it counts.) Said as text instead, with the glyph and the
// count hidden behind it, so the reading is the sentence and not its parts.
const MatrixCellGlyph = ({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  children: ReactNode;
}) => (
  <Tooltip
    content={tooltip ?? label}
    render={<span className="flex h-6 w-fit items-center text-xs" />}
  >
    <span className="sr-only">{label}</span>
    <span aria-hidden="true" className="flex items-center gap-1.5">
      {children}
    </span>
  </Tooltip>
);

const ServableTooltipBody = ({ channel }: { channel: SyntheticBuildChannel }) => (
  <span className="flex max-w-52 flex-col gap-0.5">
    <span>
      {channel.updateCount} {pluralize(channel.updateCount, "update")}{" "}
      {channel.isPaused ? "ready" : "servable"}
    </span>
    {channel.latestUpdateMessage ? (
      <span className="text-kumo-inverse/70 truncate">Latest: {channel.latestUpdateMessage}</span>
    ) : null}
    {channel.rolloutActive ? <span className="text-kumo-inverse/70">Rollout active</span> : null}
    {channel.isPaused ? (
      <span className="text-kumo-inverse/70">Paused — nothing is served</span>
    ) : null}
  </span>
);

// The channel's own state, said once at the top of its column.
const MatrixChannelHeader = ({ name, isPaused }: { name: string; isPaused: boolean }) =>
  isPaused ? (
    <Tooltip
      content="Paused — this channel serves no updates until it is resumed"
      render={<span className="flex items-center gap-1.5" />}
    >
      {name}
      <span className="sr-only">Paused</span>
      {/* Said above, drawn here — see MatrixCellGlyph for why not `aria-label`. */}
      <span
        aria-hidden="true"
        className="bg-kumo-warning inline-block size-2 shrink-0 rounded-full"
      />
    </Tooltip>
  ) : (
    name
  );

// A paused channel is a fact about the column, not about each build in it — it
// used to overwrite every cell with an unlabelled amber dot, so a paused column
// read as a column of dots with no reading. The header carries it once now, and
// the cells keep saying what they know: how many updates are ready, drawn quiet
// because a paused channel serves none of them.
const MatrixStatusCell = ({
  build,
  channel,
}: {
  build: BuildWithSyntheticChannels;
  channel: SyntheticBuildChannel;
}) => {
  if (!build.runtimeVersion) {
    return (
      <MatrixCellGlyph label="No runtime version on this build">
        <span className="text-kumo-subtle">—</span>
      </MatrixCellGlyph>
    );
  }

  // Only builds that DO receive updates get color — "no updates" is the quiet default.
  return channel.updateCount > 0 ? (
    <MatrixCellGlyph
      label={
        channel.isPaused
          ? `${channel.updateCount} ${pluralize(channel.updateCount, "update")} ready, held by a paused channel`
          : `${channel.updateCount} ${pluralize(channel.updateCount, "update")} servable`
      }
      tooltip={<ServableTooltipBody channel={channel} />}
    >
      <CheckCircleIcon
        weight="bold"
        className={cn("size-3.5", channel.isPaused ? "text-kumo-inactive" : "text-kumo-success")}
        aria-hidden="true"
      />
      <span
        className={cn(
          "font-medium tabular-nums",
          channel.isPaused ? "text-kumo-subtle" : undefined,
        )}
      >
        {channel.updateCount}
      </span>
    </MatrixCellGlyph>
  ) : (
    <MatrixCellGlyph label="No updates on this channel yet">
      <span className="bg-kumo-badge-neutral/40 size-2 rounded-full" aria-hidden="true" />
    </MatrixCellGlyph>
  );
};

const MatrixBuildRow = ({ build }: { build: BuildWithSyntheticChannels }) => (
  <TableRow key={build.id}>
    <TableCell className={PRIMARY_COLUMN_CLASS}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{buildLabel(build)}</span>
        <span className="text-kumo-subtle flex items-center gap-2 font-mono text-xs">
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
        <TablePanel
          title="Builds × channels"
          description="Check which builds can receive OTA updates from each channel — hover a cell for details."
          footer={
            hiddenCount > 0 ? (
              <span className="text-kumo-subtle text-xs">
                Showing the first {MATRIX_ROW_LIMIT} builds of the current view — {hiddenCount} more
                in the table below.
              </span>
            ) : undefined
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={PRIMARY_COLUMN_CLASS}>Build</TableHead>
                <TableHead>Runtime</TableHead>
                {channels.map((channel) => (
                  <TableHead key={channel.channelId}>
                    <MatrixChannelHeader name={channel.channelName} isPaused={channel.isPaused} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {synthesized.map((build) => (
                <MatrixBuildRow key={build.id} build={build} />
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </div>
  );
};
