import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { DownloadIcon } from "lucide-react";

import { formatBytes } from "./-build-helpers";
import { DeleteBuildDialog } from "./-delete-build-dialog";
import { InstallLinkDialog } from "./-install-link-dialog";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

const statusText = (count: number) =>
  count > 0 ? `✓ ${count} updates` : "✗ no updates for this runtimeVersion";

const renderStatusBadge = (channel: SyntheticBuildChannel) => {
  if (channel.isPaused) {
    return <Badge variant="outline">Paused</Badge>;
  }
  if (channel.updateCount > 0) {
    return <Badge variant="default">{statusText(channel.updateCount)}</Badge>;
  }
  return <span className="text-muted-foreground">{statusText(channel.updateCount)}</span>;
};

const CompatibleChannels = ({ build }: { build: BuildWithSyntheticChannels }) => {
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
      {renderStatusBadge(channel)}
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
  projectSlug,
  showDetailsLink = true,
}: {
  build: BuildWithSyntheticChannels;
  orgId: string;
  projectId: string;
  projectSlug: string;
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
              href={`/projects/${projectSlug}/builds/${build.id}`}
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Download artifact"
                      render={
                        // eslint-disable-next-line jsx-a11y/anchor-has-content -- Base UI merges Button children (DownloadIcon) into the rendered anchor via mergeProps
                        <a href={`/api/builds/${build.id}/artifact`} />
                      }
                    />
                  }
                >
                  <DownloadIcon strokeWidth={2} />
                </TooltipTrigger>
                <TooltipPopup>Download artifact</TooltipPopup>
              </Tooltip>
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
