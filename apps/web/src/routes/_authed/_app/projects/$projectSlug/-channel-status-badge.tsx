import type { Channel } from "@better-update/api";

import { StatusDot } from "../../../../../components/status-dot";
import { parseRolloutState } from "./-channel-rollout-state";

// Single source for channel status presentation (Paused / rolling out / Live),
// shared by the channels list, the channel detail page, and the project
// overview so every surface renders the same state the same way. Geist-style:
// dot + label, and only the in-progress rollout animates.
export const ChannelStatusBadge = ({ channel }: { channel: Channel }) => {
  if (channel.isPaused) {
    return <StatusDot tone="warning">Paused</StatusDot>;
  }
  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;
  if (rolloutState) {
    return (
      <StatusDot tone="info" pulse>
        {/* Name the branch when the server could resolve it; when it could not,
            say less rather than printing an opaque id at someone. */}
        {channel.rolloutTargetBranchName === undefined
          ? `Rolling out ${rolloutState.percentage}%`
          : `Rolling out to ${channel.rolloutTargetBranchName} ${rolloutState.percentage}%`}
      </StatusDot>
    );
  }
  return <StatusDot tone="success">Live</StatusDot>;
};
