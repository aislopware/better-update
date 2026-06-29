import { generateVaultKey } from "@better-update/credentials-crypto";
import { Effect } from "effect";

import { IdentityError } from "../lib/exit-codes";
import { getActiveOrgId } from "./credential-cipher";
import { ENV_VAULT_INITIAL_VERSION, rekeyEnvDek, wrapEnvKeyToRecipients } from "./env-vault-rekey";
import { unlockVaultKeyInteractive } from "./vault-access";
import { currentRecipients } from "./vault-rotation";

import type { ApiClient } from "../services/api-client";

/**
 * Every recipient the env key is wrapped to at cutover: the credentials vault's
 * device/recovery/machine recipients (so upgraded CLIs keep env access via their
 * device key) PLUS every member's account key (so the browser can unlock env). New
 * account keys enrolled later self-link via `credentials account create`.
 */
const collectEnvRecipients = (api: ApiClient) =>
  Effect.gen(function* () {
    const cvRecipients = yield* currentRecipients(api);
    const { items: accounts } = yield* api.accountKeys.list();
    return [
      ...cvRecipients.map((key) => ({
        recipientKind: key.kind,
        recipientId: key.id,
        recipient: key.publicKey,
      })),
      ...accounts.map((account) => ({
        recipientKind: "account" as const,
        recipientId: account.id,
        recipient: account.agePublicKey,
      })),
    ];
  });

/**
 * Re-key every env DEK from the credentials vault key to the new env key. Env
 * values live in the credentials vault until cutover, so the source set comes from
 * `orgVault.listCredentialDeks` filtered to env rows (`credentialType` ===
 * `envVarValue`); each is unwrapped under the credentials key and re-wrapped under
 * the env key at version 1.
 */
const rekeyEnvDeksToEnvVault = (
  api: ApiClient,
  params: { readonly orgId: string; readonly cvKey: Uint8Array; readonly evKey: Uint8Array },
) =>
  Effect.gen(function* () {
    const { deks } = yield* api.orgVault.listCredentialDeks();
    return yield* Effect.forEach(
      deks.filter((dek) => dek.credentialType === "envVarValue"),
      (dek) =>
        Effect.try({
          try: () =>
            rekeyEnvDek({
              orgId: params.orgId,
              credentialId: dek.credentialId,
              wrappedDek: dek.wrappedDek,
              from: params.cvKey,
              fromVersion: dek.vaultVersion,
              fromKind: "credentials",
              to: params.evKey,
              toVersion: ENV_VAULT_INITIAL_VERSION,
              toKind: "env",
            }),
          catch: () =>
            new IdentityError({
              message:
                "Failed to re-key an env value during the migration — re-unlock the vault and retry.",
            }),
        }),
      { concurrency: "unbounded" },
    );
  });

/**
 * One-shot cutover: fork the org's env values into a separate env vault. Generate
 * a fresh env key, wrap it to every recipient, re-key every env DEK from the
 * credentials key to the env key, and submit it all atomically. The server
 * compare-and-swaps on the cutover sentinel, so a re-run after a partial failure is
 * safe (a second cutover is rejected `Conflict`). The credentials vault — and
 * every signing credential — is untouched.
 */
export const cutoverEnvVault = (api: ApiClient) =>
  Effect.gen(function* () {
    const orgId = yield* getActiveOrgId(api);
    const vault = yield* api.orgVault.get().pipe(
      Effect.catchTag(
        "NotFound",
        () =>
          new IdentityError({
            message:
              "This organization has no credential vault yet. Run `better-update credentials identity init` first.",
          }),
      ),
    );
    if (vault.envVaultCutoverAt !== null) {
      return yield* new IdentityError({
        message: "This organization's env vault is already migrated.",
      });
    }

    const current = yield* unlockVaultKeyInteractive(api);
    const evKey = generateVaultKey();
    const recipients = yield* collectEnvRecipients(api);
    const wraps = yield* wrapEnvKeyToRecipients(evKey, recipients);
    const envDeks = yield* rekeyEnvDeksToEnvVault(api, { orgId, cvKey: current.vaultKey, evKey });

    return yield* api.envVault.cutover({ payload: { wraps, envDeks } });
  });
