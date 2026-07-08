import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { StatusDot } from "../../../../../components/status-dot";
import { parseRolloutState } from "./-channel-rollout-state";

// Single source for channel status presentation (Paused / rolling out / Live),
// shared by the channels list, the channel detail page, and the project
// overview so every surface renders the same state the same way. Geist-style:
// dot + label, and only the in-progress rollout animates.
export const ChannelStatusBadge = ({
  channel,
  branches,
}: {
  channel: Channel;
  branches: readonly BranchItem[];
}) => {
  if (channel.isPaused) {
    return <StatusDot tone="warning">Paused</StatusDot>;
  }
  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;
  if (rolloutState) {
    const target = branches.find((branch) => branch.id === rolloutState.targetBranchId);
    return (
      <StatusDot tone="info" pulse>
        Rolling out to {target?.name ?? rolloutState.targetBranchId} {rolloutState.percentage}%
      </StatusDot>
    );
  }
  return <StatusDot tone="success">Live</StatusDot>;
};
