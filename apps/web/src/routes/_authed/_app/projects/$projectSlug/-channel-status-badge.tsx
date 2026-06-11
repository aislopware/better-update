import { Badge } from "@better-update/ui/components/ui/badge";

import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { parseRolloutState } from "./-channel-rollout-state";

// Single source for channel status presentation (Paused / rolling out / Live),
// shared by the channels list and the channel detail page so both surfaces
// render the same state with the same variant.
export const ChannelStatusBadge = ({
  channel,
  branches,
}: {
  channel: Channel;
  branches: readonly BranchItem[];
}) => {
  if (channel.isPaused) {
    return <Badge variant="warning">Paused</Badge>;
  }
  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;
  if (rolloutState) {
    const target = branches.find((branch) => branch.id === rolloutState.targetBranchId);
    return (
      <Badge variant="secondary">
        Rolling out to {target?.name ?? rolloutState.targetBranchId} {rolloutState.percentage}%
      </Badge>
    );
  }
  return <Badge variant="outline">Live</Badge>;
};
