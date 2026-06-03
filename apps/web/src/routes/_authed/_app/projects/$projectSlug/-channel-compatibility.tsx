import { Badge } from "@better-update/ui/components/ui/badge";

import type { MissingRuntimeVersionBuild } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { formatDateTime } from "../../../../../lib/format-date";

import type { CompatibleBuildEntry } from "./-channel-compatibility-helpers";
import type { SyntheticBuildChannel } from "./-compatibility-join";

const StatusBadge = ({ status }: { status: SyntheticBuildChannel }) => {
  if (status.isPaused) {
    return <Badge variant="outline">Paused</Badge>;
  }

  if (status.updateCount > 0) {
    return <Badge variant="default">✓ {status.updateCount} updates</Badge>;
  }

  return <Badge variant="secondary">✗ no updates</Badge>;
};

export const CompatibleBuildsSection = ({
  compatibleBuilds,
}: {
  compatibleBuilds: readonly CompatibleBuildEntry[];
}) => {
  if (compatibleBuilds.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Compatible builds</span>
        <p className="text-muted-foreground text-sm">
          No builds have been uploaded for this project yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Compatible builds</span>
      {compatibleBuilds.map(({ build, status }) => (
        <div key={`${status.channelId}:${build.id}`} className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {(build.message ?? build.profile) || build.id.slice(0, 8)}
            </span>
            <PlatformBadge platform={build.platform} />
            {build.runtimeVersion ? (
              <span className="text-muted-foreground">v{build.runtimeVersion}</span>
            ) : (
              <Badge variant="secondary">Missing runtimeVersion</Badge>
            )}
            <StatusBadge status={status} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {build.appVersion && <span>App {build.appVersion}</span>}
            {build.buildNumber && <span>#{build.buildNumber}</span>}
            <span>{formatDateTime(build.createdAt)}</span>
            {status.latestUpdateMessage && <span>latest {status.latestUpdateMessage}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

export const MissingMatchingBuilds = ({
  missingRuntimeVersions,
}: {
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => {
  if (missingRuntimeVersions.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/40 border-border rounded-3xl border p-4">
      <div className="mb-2 text-sm font-medium">Missing matching builds</div>
      <div className="flex flex-col gap-2">
        {missingRuntimeVersions.map((entry) => (
          <div
            key={`${entry.channelId}:${entry.platform}:${entry.runtimeVersion}`}
            className="text-sm"
          >
            <span className="font-medium">
              {entry.platform} v{entry.runtimeVersion}
            </span>
            <span className="text-muted-foreground">
              {" "}
              has {entry.updateCount} updates but no uploaded build.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
