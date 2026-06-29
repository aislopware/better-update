import { generateVaultKey } from "@better-update/credentials-crypto";
import { Effect } from "effect";

import { IdentityError } from "../lib/exit-codes";
import { getActiveOrgId } from "./credential-cipher";
import { forgetCachedEnvVaultKey, unlockEnvVaultKeyInteractive } from "./env-vault-access";
import { rekeyEnvDek, wrapEnvKeyToRecipients } from "./env-vault-rekey";

import type { ApiClient } from "../services/api-client";
import type { EnvRecipient } from "./env-vault-rekey";

/**
 * Resolve the env vault's CURRENT recipients to the age recipients the new key is
 * wrapped to. The recipient set comes from `envVault.listWraps` (a member removal
 * already dropped the departing user's wraps server-side), and each id is resolved
 * to its public key: device/recovery/machine via `userEncryptionKeys`, account via
 * `accountKeys`. An id that no longer resolves (revoked) is dropped — the server
 * still enforces that a recovery recipient remains.
 */
const rewrapSurvivingRecipients = (api: ApiClient, evKey: Uint8Array) =>
  Effect.gen(function* () {
    const { recipients } = yield* api.envVault.listWraps();
    const [{ items: keys }, { items: accounts }] = yield* Effect.all([
      api.userEncryptionKeys.list(),
      api.accountKeys.list(),
    ]);
    const keyById = new Map(keys.map((key) => [key.id, key.publicKey]));
    const accountById = new Map(accounts.map((account) => [account.id, account.agePublicKey]));
    const resolved: EnvRecipient[] = recipients.flatMap((wrap) => {
      const recipient =
        wrap.recipientKind === "account"
          ? accountById.get(wrap.recipientId)
          : keyById.get(wrap.recipientId);
      return recipient === undefined
        ? []
        : [{ recipientKind: wrap.recipientKind, recipientId: wrap.recipientId, recipient }];
    });
    return yield* wrapEnvKeyToRecipients(evKey, resolved);
  });

/** Re-key every env DEK under the new env key, bumping it to the next env version. */
const rekeyEnvDeksForRotation = (
  api: ApiClient,
  params: {
    readonly orgId: string;
    readonly fromKey: Uint8Array;
    readonly toKey: Uint8Array;
    readonly toVersion: number;
  },
) =>
  Effect.gen(function* () {
    const { deks } = yield* api.envVault.listCredentialDeks();
    return yield* Effect.forEach(
      deks,
      (dek) =>
        Effect.try({
          try: () =>
            rekeyEnvDek({
              orgId: params.orgId,
              credentialId: dek.credentialId,
              wrappedDek: dek.wrappedDek,
              from: params.fromKey,
              fromVersion: dek.vaultVersion,
              fromKind: "env",
              to: params.toKey,
              toVersion: params.toVersion,
              toKind: "env",
            }),
          catch: () =>
            new IdentityError({
              message:
                "Failed to re-key an env value during rotation — re-unlock the env vault and retry.",
            }),
        }),
      { concurrency: "unbounded" },
    );
  });

/**
 * Rotate the env vault key: generate a new key at version+1, re-wrap it to the
 * current recipients, re-key every env DEK, and submit atomically (the server
 * compare-and-swaps on the env version). Clears the env rotation-pending flag a
 * member removal raised. Drops the now-stale cached env key afterwards.
 */
export const rotateEnvVault = (api: ApiClient) =>
  Effect.gen(function* () {
    const orgId = yield* getActiveOrgId(api);
    const vault = yield* api.orgVault
      .get()
      .pipe(
        Effect.catchTag(
          "NotFound",
          () => new IdentityError({ message: "This organization has no credential vault yet." }),
        ),
      );
    if (vault.envVaultCutoverAt === null) {
      return yield* new IdentityError({
        message:
          "This organization has no env vault yet — run `better-update credentials env-vault migrate` first.",
      });
    }

    const current = yield* unlockEnvVaultKeyInteractive(api);
    const toVersion = current.vaultVersion + 1;
    const newEvKey = generateVaultKey();
    const wraps = yield* rewrapSurvivingRecipients(api, newEvKey);
    const envDeks = yield* rekeyEnvDeksForRotation(api, {
      orgId,
      fromKey: current.vaultKey,
      toKey: newEvKey,
      toVersion,
    });

    const rotated = yield* api.envVault.rotate({
      payload: { fromVersion: current.vaultVersion, wraps, envDeks },
    });
    yield* forgetCachedEnvVaultKey;
    return rotated;
  });
