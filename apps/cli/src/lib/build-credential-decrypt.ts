import { Effect } from "effect";

import { openEnvelope, openVaultSessionInteractive } from "../application/credential-cipher";
import { requireSecretString } from "./credential-secret";
import { MissingCredentialsError } from "./exit-codes";

import type { VaultSession } from "../application/credential-cipher";

/**
 * Local decryption for the build-resolve flow. `resolve` is zero-knowledge: it
 * returns ciphertext + wrapped DEK bound (AAD) to the credential row id, so the
 * CLI unwraps it here before staging the build. Crypto/identity failures surface
 * as MissingCredentialsError to keep the build flow's credential error channel
 * narrow.
 */

/**
 * Unlock the vault once for a build: resolve the device passphrase (prompt for a
 * file identity, none for the CI env key) and open the session, re-tagging any
 * failure as MissingCredentialsError. The session is threaded into every
 * {@link decryptResolveSecret} so a multi-target build unlocks a single time.
 */
export const openVaultSessionForBuild = (
  api: Parameters<typeof openVaultSessionInteractive>[0],
  hint: string,
) =>
  openVaultSessionInteractive(api).pipe(
    Effect.mapError(
      (cause) =>
        new MissingCredentialsError({
          message: `Could not unlock the credential vault: ${cause.message}`,
          hint,
        }),
    ),
  );

/**
 * Decrypt a build-resolve envelope and pull its string secret fields. The caller
 * supplies the credential row id it knows out-of-band (e.g. the dist-cert id from
 * the resolve `context`), which the DEK-wrap AAD is bound to, plus the unlocked
 * {@link VaultSession} from {@link openVaultSessionForBuild}.
 */
export const decryptResolveSecret = <Field extends string>(params: {
  readonly session: VaultSession;
  readonly credentialType: string;
  readonly credentialId: string;
  readonly envelope: {
    readonly ciphertext: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
  };
  readonly fields: readonly Field[];
  readonly hint: string;
}): Effect.Effect<Record<Field, string>, MissingCredentialsError> =>
  openEnvelope({
    session: params.session,
    credentialType: params.credentialType,
    credentialId: params.credentialId,
    envelope: params.envelope,
    serverMetadata: {},
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MissingCredentialsError({
          message: `Failed to decrypt ${params.credentialType} build credential: ${cause.message}`,
          hint: params.hint,
        }),
    ),
    Effect.flatMap((secret) =>
      Effect.reduce(
        params.fields,
        // The reduce fully populates every requested field below (failing if any
        // is absent), so the empty seed is the typed accumulator for the result.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- typed empty accumulator for a reduce that populates all `fields`
        {} as Record<Field, string>,
        (acc, field) =>
          Effect.gen(function* () {
            const value = yield* requireSecretString(
              secret,
              field,
              () =>
                new MissingCredentialsError({
                  message: `Decrypted ${params.credentialType} credential is missing "${field}".`,
                  hint: params.hint,
                }),
            );
            return { ...acc, [field]: value };
          }),
      ),
    ),
  );
