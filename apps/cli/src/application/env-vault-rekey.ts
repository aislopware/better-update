import { unwrapDek, wrapDek, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import type { EnvVaultRecipientKind } from "@better-update/api";
import type { VaultKind } from "@better-update/credentials-crypto";

/** One env wrap row in a cutover / rotation submission (the env key sealed to a recipient). */
export interface EnvWrapInput {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
  readonly wrappedKey: string;
}

/** One env-var revision's DEK re-wrapped under the new env key. */
export interface EnvDekUpdate {
  readonly credentialId: string;
  readonly wrappedDek: string;
}

/** A recipient to seal the env key to: its id/kind for the wrap row + its age recipient. */
export interface EnvRecipient {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
  readonly recipient: string;
}

/**
 * Re-wrap a single env DEK from one vault key to another, rebinding it to the
 * destination vault version + kind. Pure crypto — throws (propagated AEAD failure)
 * if the source key/binding is wrong. Shared by the cutover (credentials→env) and
 * the env rotation (env→env).
 */
export const rekeyEnvDek = (args: {
  readonly orgId: string;
  readonly credentialId: string;
  readonly wrappedDek: string;
  readonly from: Uint8Array;
  readonly fromVersion: number;
  readonly fromKind: VaultKind;
  readonly to: Uint8Array;
  readonly toVersion: number;
  readonly toKind: VaultKind;
}): EnvDekUpdate => {
  const raw = unwrapDek({
    wrappedDek: fromBase64(args.wrappedDek),
    vaultKey: args.from,
    binding: {
      orgId: args.orgId,
      credentialId: args.credentialId,
      vaultVersion: args.fromVersion,
      vaultKind: args.fromKind,
    },
  });
  return {
    credentialId: args.credentialId,
    wrappedDek: toBase64(
      wrapDek({
        dek: raw,
        vaultKey: args.to,
        binding: {
          orgId: args.orgId,
          credentialId: args.credentialId,
          vaultVersion: args.toVersion,
          vaultKind: args.toKind,
        },
      }),
    ),
  };
};

/** Seal the env key to each recipient, producing the wrap rows for a cutover / rotation. */
export const wrapEnvKeyToRecipients = (
  evKey: Uint8Array,
  recipients: readonly EnvRecipient[],
): Effect.Effect<readonly EnvWrapInput[]> =>
  Effect.forEach(
    recipients,
    (entry) =>
      Effect.promise(async () => ({
        recipientKind: entry.recipientKind,
        recipientId: entry.recipientId,
        wrappedKey: toBase64(await wrapVaultKey({ vaultKey: evKey, recipient: entry.recipient })),
      })),
    { concurrency: "unbounded" },
  );
