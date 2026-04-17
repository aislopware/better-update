import { Effect } from "effect";

import { evaluateBranchMapping } from "../domain/branch-mapping";

import type { CryptoService } from "../domain/crypto-service";
import type { ChannelRow } from "../repositories/manifest";

export const resolveBranchId = (
  channel: ChannelRow,
  easClientId: string | undefined,
): Effect.Effect<string, never, CryptoService> => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? evaluateBranchMapping(mapping, easClientId).pipe(
        Effect.orElseSucceed(() => channel.branch_id),
      )
    : Effect.succeed(channel.branch_id);
};
