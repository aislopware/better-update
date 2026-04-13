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

import type { BuildCompatibilityRow, MissingRuntimeVersionBuild } from "@better-update/api";

const buildLabel = (build: typeof BuildCompatibilityRow.Type) =>
  (build.message ?? build.profile) || build.id.slice(0, 8);

const MatrixStatusCell = ({
  build,
  channel,
}: {
  build: typeof BuildCompatibilityRow.Type;
  channel: (typeof BuildCompatibilityRow.Type)["channels"][number];
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

  return (
    <Badge variant={channel.updateCount > 0 ? "default" : "secondary"} className="w-fit">
      {channel.updateCount > 0 ? `✓ ${channel.updateCount} updates` : "⚠ No updates"}
    </Badge>
  );
};

const MatrixBuildRow = ({ build }: { build: typeof BuildCompatibilityRow.Type }) => (
  <TableRow key={build.id}>
    <TableCell className="whitespace-normal">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{buildLabel(build)}</span>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{build.platform}</Badge>
          {build.appVersion && <span>App {build.appVersion}</span>}
          {build.buildNumber && <span>#{build.buildNumber}</span>}
        </div>
      </div>
    </TableCell>
    <TableCell className="whitespace-normal">
      {build.runtimeVersion ? (
        <span className="font-medium">v{build.runtimeVersion}</span>
      ) : (
        <Badge variant="secondary">Missing</Badge>
      )}
    </TableCell>
    {build.channels.map((channel) => (
      <TableCell key={`${build.id}:${channel.channelId}`} className="whitespace-normal">
        <div className="flex min-w-36 flex-col gap-1">
          <MatrixStatusCell build={build} channel={channel} />
          {channel.rolloutActive && (
            <Badge variant="outline" className="w-fit">
              Rollout active
            </Badge>
          )}
          {channel.latestUpdateMessage && (
            <span className="text-muted-foreground text-xs">{channel.latestUpdateMessage}</span>
          )}
        </div>
      </TableCell>
    ))}
  </TableRow>
);

export const CompatibilityMatrix = ({
  rows,
  missingRuntimeVersions,
}: {
  rows: readonly (typeof BuildCompatibilityRow.Type)[];
  missingRuntimeVersions: readonly (typeof MissingRuntimeVersionBuild.Type)[];
}) => {
  const channels = rows[0]?.channels ?? [];

  if (rows.length === 0 && missingRuntimeVersions.length === 0) {
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
                <Badge variant="outline">{entry.channelName}</Badge>
                <Badge variant="secondary">{entry.platform}</Badge>
                <span className="font-medium">v{entry.runtimeVersion}</span>
                <span className="text-muted-foreground">
                  {entry.updateCount} updates, latest {entry.latestUpdateMessage}
                </span>
                {entry.rolloutActive && <Badge variant="outline">Rollout active</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && channels.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Builds × Channels</CardTitle>
            <CardDescription>
              Check which builds can receive OTA updates from each channel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Build</TableHead>
                  <TableHead>Runtime Version</TableHead>
                  {channels.map((channel) => (
                    <TableHead key={channel.channelId}>{channel.channelName}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((build) => (
                  <MatrixBuildRow key={build.id} build={build} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
