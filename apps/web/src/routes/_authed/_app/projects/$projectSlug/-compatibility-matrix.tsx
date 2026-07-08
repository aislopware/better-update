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

import type {
  BuildCompatibilityMatrixResult,
  BuildWithArtifact,
  MissingRuntimeVersionBuild,
} from "@better-update/api";

import {
  ChannelBadge,
  PlatformBadge,
  PlatformIndicator,
} from "../../../../../components/attribute-badges";
import { pluralize } from "../../../../../lib/pluralize";
import { synthesizeBuildChannels } from "./-compatibility-join";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

const buildLabel = (build: BuildWithSyntheticChannels) =>
  (build.message ?? build.profile) || build.id.slice(0, 8);

const MatrixStatusCell = ({
  build,
  channel,
}: {
  build: BuildWithSyntheticChannels;
  channel: SyntheticBuildChannel;
}) => {
  if (channel.isPaused) {
    return (
      <Badge variant="outline" className="w-fit">
        Paused
      </Badge>
    );
  }

  if (build.runtimeVersion === null) {
    return <span className="text-muted-foreground text-xs">No runtime version</span>;
  }

  // Only builds that DO receive updates get color — "no updates" is the quiet default.
  return channel.updateCount > 0 ? (
    <Badge variant="success" className="w-fit">
      {channel.updateCount} {pluralize(channel.updateCount, "update")}
    </Badge>
  ) : (
    <span className="text-muted-foreground text-xs">No updates</span>
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
        <div className="flex min-w-36 flex-col gap-1">
          <MatrixStatusCell build={build} channel={channel} />
          {channel.rolloutActive && (
            <Badge variant="info" className="w-fit">
              Rollout active
            </Badge>
          )}
          {channel.latestUpdateMessage && (
            <span className="text-muted-foreground max-w-40 truncate text-xs">
              {channel.latestUpdateMessage}
            </span>
          )}
        </div>
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
      {missingRuntimeVersions.length > 0 && (
        <Card className="border-border bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle>Missing native builds</CardTitle>
            <CardDescription>
              These channel/runtime combinations have OTA updates but no uploaded build with the
              same runtime version.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {missingRuntimeVersions.map((entry) => (
              <div
                key={`${entry.channelId}:${entry.platform}:${entry.runtimeVersion}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <ChannelBadge name={entry.channelName} />
                <PlatformBadge platform={entry.platform} />
                <span className="font-medium">v{entry.runtimeVersion}</span>
                <span className="text-muted-foreground">
                  {entry.updateCount} {pluralize(entry.updateCount, "update")}, latest{" "}
                  {entry.latestUpdateMessage}
                </span>
                {entry.rolloutActive && <Badge variant="outline">Rollout active</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {synthesized.length > 0 && channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Builds × Channels</CardTitle>
            <CardDescription>
              Check which builds can receive OTA updates from each channel.
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
