import {
  generateVaultKey,
  unwrapDek,
  wrapDek,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { IdentityError } from "../lib/exit-codes";
import { getActiveOrgId } from "./credential-cipher";
import { forgetCachedVaultKey, unlockVaultKeyInteractive } from "./vault-access";

import type { ApiClient } from "../services/api-client";

/** A recipient the rotated vault key is re-wrapped to. */
export interface RotationRecipient {
  readonly userEncryptionKeyId: string;
  readonly publicKey: string;
}

/**
 * Re-key the org vault to `recipients`: generate a new vault key (v+1), unwrap
 * every credential + env-var DEK with the old key and re-wrap it under the new
 * one, re-wrap the new vault key to each recipient, then submit the rotation
 * atomically (the server CAS-guards on the current version and requires a
 * recovery recipient in the set). Drops every recipient not in `recipients`.
 *
 * Unlocks via the cache-aware path (reusing a live `credentials unlock` session),
 * then drops that cached key once the re-key lands — it is now stale, so the next
 * operation must re-unlock at the new version.
 */
export const rotateVaultTo = (args: {
  readonly api: ApiClient;
  readonly recipients: readonly RotationRecipient[];
}) =>
  Effect.gen(function* () {
    const orgId = yield* getActiveOrgId(args.api);
    const current = yield* unlockVaultKeyInteractive(args.api);
    const newVaultKey = generateVaultKey();
    const newVersion = current.vaultVersion + 1;

    const { deks } = yield* args.api.orgVault.listCredentialDeks();
    const credentialDeks = yield* Effect.forEach(
      deks,
      (dek) =>
        Effect.try({
          try: () => {
            const raw = unwrapDek({
              wrappedDek: fromBase64(dek.wrappedDek),
              vaultKey: current.vaultKey,
              binding: {
                orgId,
                credentialId: dek.credentialId,
                vaultVersion: dek.vaultVersion,
                vaultKind: "credentials",
              },
            });
            return {
              credentialType: dek.credentialType,
              credentialId: dek.credentialId,
              wrappedDek: toBase64(
                wrapDek({
                  dek: raw,
                  vaultKey: newVaultKey,
                  binding: {
                    orgId,
                    credentialId: dek.credentialId,
                    vaultVersion: newVersion,
                    vaultKind: "credentials",
                  },
                }),
              ),
            };
          },
          catch: () =>
            new IdentityError({
              message: `Failed to re-wrap a ${dek.credentialType} DEK during rotation — re-unlock the vault and retry.`,
            }),
        }),
      { concurrency: "unbounded" },
    );

    const recipientWraps = yield* Effect.forEach(
      args.recipients,
      (recipient) =>
        Effect.promise(async () => ({
          userEncryptionKeyId: recipient.userEncryptionKeyId,
          wrappedKey: toBase64(
            await wrapVaultKey({ vaultKey: newVaultKey, recipient: recipient.publicKey }),
          ),
        })),
      { concurrency: "unbounded" },
    );

    const rotated = yield* args.api.orgVault.rotate({
      payload: { fromVersion: current.vaultVersion, recipientWraps, credentialDeks },
    });
    yield* forgetCachedVaultKey;
    return rotated;
  });

/** The encryption keys currently holding the vault key, joined with their public keys. */
export const currentRecipients = (api: ApiClient) =>
  Effect.gen(function* () {
    const [wraps, keys] = yield* Effect.all([
      api.orgVault.listWraps(),
      api.userEncryptionKeys.list(),
    ]);
    const byId = new Map(keys.items.map((key) => [key.id, key]));
    return wraps.recipients
      .map((recipient) => byId.get(recipient.userEncryptionKeyId))
      .filter((key): key is UserEncryptionKey => key !== undefined);
  });
