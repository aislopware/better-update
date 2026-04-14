import { Context, Effect, Layer } from "effect";

import {
  decryptSecret,
  encryptSecret,
  envelopeDecrypt,
  envelopeEncrypt,
  resolveKeyring,
} from "../domain/credential-vault";
import { cloudflareEnv } from "./context";

export interface VaultService {
  readonly encryptSecret: (params: {
    readonly organizationId: string;
    readonly value: string;
  }) => Effect.Effect<{ readonly encrypted: string; readonly keyVersion: number }, Error>;
  readonly decryptSecret: (params: {
    readonly organizationId: string;
    readonly keyVersion: number;
    readonly encrypted: string;
  }) => Effect.Effect<string, Error>;
  readonly envelopeEncrypt: (params: {
    readonly organizationId: string;
    readonly plaintext: Uint8Array;
  }) => Effect.Effect<
    {
      readonly encryptedBlob: Uint8Array;
      readonly encryptedDek: string;
      readonly keyVersion: number;
    },
    Error
  >;
  readonly envelopeDecrypt: (params: {
    readonly organizationId: string;
    readonly keyVersion: number;
    readonly encryptedDek: string;
    readonly encryptedBlob: Uint8Array;
  }) => Effect.Effect<Uint8Array, Error>;
}

export class Vault extends Context.Tag("server/Vault")<Vault, VaultService>() {}

const resolveConfiguredKeyring = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  return yield* resolveKeyring(env.VAULT_KEYRING);
});

export const VaultLive = Layer.succeed(Vault, {
  encryptSecret: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* encryptSecret(keyring, params.organizationId, params.value);
    }),

  decryptSecret: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* decryptSecret(
        keyring,
        params.organizationId,
        params.keyVersion,
        params.encrypted,
      );
    }),

  envelopeEncrypt: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* envelopeEncrypt(keyring, params.organizationId, params.plaintext);
    }),

  envelopeDecrypt: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* envelopeDecrypt(
        keyring,
        params.organizationId,
        params.keyVersion,
        params.encryptedDek,
        params.encryptedBlob,
      );
    }),
});
