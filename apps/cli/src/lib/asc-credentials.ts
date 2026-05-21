import { Effect } from "effect";

import { openFromDownload, openVaultSessionInteractive } from "../application/credential-cipher";
import { IdentityError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";

/**
 * Fetch an ASC API key and decrypt its `.p8` PEM locally. The server is
 * zero-knowledge: `getCredentials` returns the encrypted envelope, so the CLI
 * unwraps it here before talking to Apple. The unlock passphrase is resolved
 * lazily — prompted for a file identity, none for the CI env key.
 */
export const fetchAscCredentials = (api: ApiClient, ascApiKeyId: string) =>
  Effect.gen(function* () {
    const data = yield* api.ascApiKeys.getCredentials({ path: { id: ascApiKeyId } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "asc-api-key",
      // `getCredentials` keys the row id as `ascApiKeyId`; the cipher binds on `id`.
      downloaded: {
        id: data.ascApiKeyId,
        ciphertext: data.ciphertext,
        wrappedDek: data.wrappedDek,
        vaultVersion: data.vaultVersion,
        keyId: data.keyId,
        issuerId: data.issuerId,
      },
    });
    const { p8Pem } = secret;
    if (typeof p8Pem !== "string") {
      return yield* new IdentityError({
        message: `Decrypted ASC API key ${ascApiKeyId} is missing its .p8 PEM.`,
      });
    }
    return {
      ascApiKeyId: data.ascApiKeyId,
      keyId: data.keyId,
      issuerId: data.issuerId,
      appleTeamIdentifier: data.appleTeamIdentifier,
      p8Pem,
    };
  });
