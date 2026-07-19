import { Alert, AlertDescription, AlertTitle } from "@better-update/ui/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";

import type { MissingRuntimeVersionBuild } from "@better-update/api";

import { ChannelBadge, PlatformBadge } from "../../../../../components/attribute-badges";
import { pluralize } from "../../../../../lib/pluralize";

/**
 * The single "missing builds" warning — shared by the channel detail page and
 * the builds × channels matrix so the same gap always looks the same. Pass
 * `showChannel` where rows span multiple channels.
 */
export const MissingMatchingBuilds = ({
  missingRuntimeVersions,
  showChannel = false,
}: {
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
  showChannel?: boolean;
}) => {
  if (missingRuntimeVersions.length === 0) {
    return null;
  }

  return (
    <Alert variant="warning">
      <TriangleAlertIcon strokeWidth={2} />
      <AlertTitle>Missing matching builds</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-1.5">
          {missingRuntimeVersions.map((entry) => (
            <div
              key={`${entry.channelId}:${entry.platform}:${entry.runtimeVersion}`}
              className="flex flex-wrap items-center gap-2"
            >
              {showChannel ? <ChannelBadge name={entry.channelName} size="sm" /> : null}
              <PlatformBadge platform={entry.platform} size="sm" />
              <span className="font-mono text-xs font-medium">v{entry.runtimeVersion}</span>
              <span>
                {entry.updateCount} {pluralize(entry.updateCount, "update")} but no uploaded build.
              </span>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
};
