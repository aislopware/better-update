import { Data, Effect } from "effect";

import { evaluateBranchMapping } from "../domain/branch-mapping";

import type { ChannelRow } from "../repositories/manifest";

class BranchMappingResolutionError extends Data.TaggedError("BranchMappingResolutionError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export const resolveBranchId = (channel: ChannelRow, easClientId: string | undefined) => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? Effect.tryPromise({
        try: async () => evaluateBranchMapping(mapping, easClientId),
        catch: (cause) =>
          new BranchMappingResolutionError({
            message: "Failed to evaluate branch mapping",
            cause,
          }),
      }).pipe(Effect.orElseSucceed(() => channel.branch_id))
    : Effect.succeed(channel.branch_id);
};
