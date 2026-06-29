import { Effect } from "effect";

import { BadRequest } from "../errors";

import type { EnvVaultRecipientKind } from "../vault-models";

/** One env-vault wrap row as submitted in a bootstrap / cutover / rotation. */
export interface EnvWrapInputShape {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
  readonly wrappedKey: string;
}

/**
 * Recipient-set rules shared by every env-vault write that re-wraps the key to the
 * full recipient set (bootstrap / cutover / rotation): the set must be distinct and
 * must keep an offline recovery recipient (the break-glass invariant — a vault with
 * no recovery recipient is permanently lost if every device is lost).
 */
export const assertEnvWrapSet = (
  wraps: readonly EnvWrapInputShape[],
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const keys = wraps.map((wrap) => `${wrap.recipientKind}:${wrap.recipientId}`);
    if (new Set(keys).size !== keys.length) {
      return yield* new BadRequest({ message: "Duplicate recipient in env-vault wraps" });
    }
    if (!wraps.some((wrap) => wrap.recipientKind === "recovery")) {
      return yield* new BadRequest({
        message: "Env-vault wraps must keep an offline recovery recipient",
      });
    }
  });
