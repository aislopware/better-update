import { Effect } from "effect";

import { evaluateBranchMapping } from "../domain/branch-mapping";
import { parseExtraParamsMap } from "../protocol/sfv";

import type { CryptoService } from "../domain/crypto-service";
import type { ChannelRow } from "../repositories/manifest";

export const resolveBranchId = (
  channel: ChannelRow,
  ctx: {
    easClientId: string | undefined;
    runtimeVersion: string;
    extraParams: string | undefined;
  },
): Effect.Effect<string, never, CryptoService> => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? evaluateBranchMapping(mapping, {
        easClientId: ctx.easClientId,
        runtimeVersion: ctx.runtimeVersion,
        extraParams: parseExtraParamsMap(ctx.extraParams),
      }).pipe(
        Effect.map((branchId) => (branchId === null ? channel.branch_id : branchId)),
        Effect.orElseSucceed(() => channel.branch_id),
      )
    : Effect.succeed(channel.branch_id);
};
