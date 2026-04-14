import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { BuildCompatibilityRow } from "@better-update/api";

import { formatBytes } from "./-build-helpers";
import { DeleteBuildDialog } from "./-delete-build-dialog";
import { InstallLinkDialog } from "./-install-link-dialog";

const statusText = (count: number) =>
  count > 0 ? `✓ ${count} updates` : "✗ no updates for this runtimeVersion";

const CompatibleChannels = ({ build }: { build: typeof BuildCompatibilityRow.Type }) => {
  if (build.runtimeVersion === null) {
    return (
      <p className="text-muted-foreground text-sm">
        This build is missing `runtimeVersion`, so OTA compatibility cannot be determined.
      </p>
    );
  }

  if (build.channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No channels have been created for this project yet.
      </p>
    );
  }

  return build.channels.map((channel) => (
    <div
      key={`${build.id}:${channel.channelId}`}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <Badge variant="outline">{channel.channelName}</Badge>
      {channel.isPaused ? (
        <Badge variant="outline">Paused</Badge>
      ) : (
        <span
          className={
            channel.updateCount > 0
              ? "font-medium text-emerald-700 dark:text-emerald-400"
              : "font-medium text-amber-700 dark:text-amber-400"
          }
        >
          {statusText(channel.updateCount)}
        </span>
      )}
      {channel.rolloutActive && <Badge variant="outline">Rollout active</Badge>}
      {channel.latestUpdateMessage && (
        <span className="text-muted-foreground">latest {channel.latestUpdateMessage}</span>
      )}
    </div>
  ));
};

export const BuildCard = ({
  build,
  orgId,
  projectId,
  showDetailsLink = true,
}: {
  build: typeof BuildCompatibilityRow.Type;
  orgId: string;
  projectId: string;
  showDetailsLink?: boolean;
}) => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
          </CardTitle>
          {showDetailsLink ? (
            <a
              href={`/projects/${projectId}/builds/${build.id}`}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              View details
            </a>
          ) : null}
          <Badge variant="outline">{build.platform}</Badge>
          <Badge variant="secondary">{build.distribution}</Badge>
          {build.artifact && <Badge variant="outline">{build.artifact.format.toUpperCase()}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {build.artifact && (
            <>
              <InstallLinkDialog build={build} />
              <a href={`/api/builds/${build.id}/artifact`}>
                <Button variant="ghost" size="icon" className="size-8" title="Download artifact">
                  <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
                </Button>
              </a>
            </>
          )}
          <DeleteBuildDialog build={build} orgId={orgId} projectId={projectId} />
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {build.runtimeVersion && <span>v{build.runtimeVersion}</span>}
        {build.appVersion && <span>App {build.appVersion}</span>}
        {build.buildNumber && <span>#{build.buildNumber}</span>}
        {build.gitRef && <span className="font-mono text-xs">{build.gitRef}</span>}
        {build.artifact && <span>{formatBytes(build.artifact.byteSize)}</span>}
        <span>{new Date(build.createdAt).toLocaleString()}</span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="text-sm font-medium">Compatible channels</div>
        <CompatibleChannels build={build} />
      </div>
    </CardContent>
  </Card>
);
