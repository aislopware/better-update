import { Effect } from "effect";

import { servedCommitTime, servedCreatedAt } from "../domain/signed-update-recency";
import { UpdateRepo } from "../repositories";

import type { Platform } from "../models";

// Clock-skew guard for PRECOMPUTED publishes (signed manifests + rollback
// directives, served verbatim). The repository stamps DB `created_at` = the
// served commitTime for these rows (the publishCreatedAt invariant, see
// domain/signed-update-recency.ts), so server ordering matches the device's
// commitTime selection exactly. A precomputed publish whose commitTime is NOT
// strictly newer than the row the server currently serves would be inserted but
// never selected — silently never applying on-device; reject it up front. This
// is total under the invariant and cannot false-reject (a strictly-greater
// commitTime genuinely becomes newest for every device; otherwise it is genuinely
// never served). Unsigned normal updates + embedded baselines are exempt.
//
// Callers run it under the publish Durable Object's single-writer lock, so the
// read-then-act below has no concurrent writer to race.
export const clockSkewConflict = (params: {
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly isEmbedded: boolean;
  readonly branchId: string;
  readonly platform: Platform;
  readonly runtimeVersion: string;
}): Effect.Effect<string | null, never, UpdateRepo> =>
  Effect.gen(function* () {
    const incomingCommitTime = servedCommitTime(params);
    if (incomingCommitTime === null || params.isEmbedded) {
      return null;
    }
    const updateRepo = yield* UpdateRepo;
    const latest = yield* updateRepo.findLatestServedRow({
      branchId: params.branchId,
      platform: params.platform,
      runtimeVersion: params.runtimeVersion,
    });
    if (latest === null || incomingCommitTime > servedCreatedAt(latest)) {
      return null;
    }
    return `Clock skew: this update's commitTime (${incomingCommitTime}) is not newer than the latest published update (${servedCreatedAt(latest)}) for this branch/platform/runtimeVersion. The device selects updates by commitTime, so this update would never be applied — sync the publishing machine's clock and republish.`;
  });
