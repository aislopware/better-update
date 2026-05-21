import {
  generateIdentity,
  generateVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";

import type { Identity } from "@better-update/credentials-crypto";

import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { openFromDownload, openVaultSession, sealForUpload } from "./credential-cipher";

import type { ApiClient } from "../services/api-client";

const ORG_ID = "org_test";
const VAULT_VERSION = 3;

interface Vault {
  readonly identity: Identity;
  readonly wrappedVaultKey: string;
}

/** Generate a real identity + age-wrapped vault key (async age work runs here, not in runSync). */
const makeVault = Effect.gen(function* () {
  const identity = yield* Effect.promise(async () => generateIdentity());
  const vaultKey = generateVaultKey();
  const wrappedVaultKey = toBase64(
    yield* Effect.promise(async () => wrapVaultKey({ vaultKey, recipient: identity.publicKey })),
  );
  return { identity, wrappedVaultKey } satisfies Vault;
});

/**
 * Build an `ApiClient` whose `me.get` reports the active org, `userEncryptionKeys`
 * lists this device, and `orgVault.getWrap` returns the real wrapped vault key —
 * enough to exercise the live `openVaultSession` path the cipher is threaded.
 */
const buildApi = (vault: Vault): ApiClient =>
  ({
    me: { get: () => Effect.succeed({ activeOrganization: { id: ORG_ID } }) },
    userEncryptionKeys: {
      list: () =>
        Effect.succeed({
          items: [
            {
              id: "key-1",
              publicKey: vault.identity.publicKey,
              fingerprint: vault.identity.fingerprint,
              kind: "device",
              label: "laptop",
            },
          ],
        }),
    },
    orgVault: {
      getWrap: () =>
        Effect.succeed({ vaultVersion: VAULT_VERSION, wrappedKey: vault.wrappedVaultKey }),
    },
  }) as unknown as ApiClient;

const cliRuntimeStub = (privateKey: string) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux" as NodeJS.Platform,
    cwd: Effect.succeed("/"),
    getEnv: (name: string) =>
      Effect.succeed(name === "BETTER_UPDATE_IDENTITY" ? privateKey : undefined),
    homeDirectory: Effect.succeed("/"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

const identityStoreStub = Layer.succeed(IdentityStore, {
  load: Effect.sync(() => null),
  save: () => Effect.void,
  clear: Effect.void,
});

/** Open the vault session against the env identity (no passphrase), providing the unlock services. */
const openSession = (api: ApiClient, privateKey: string) =>
  openVaultSession(api, undefined).pipe(
    Effect.provide(Layer.mergeAll(cliRuntimeStub(privateKey), identityStoreStub)),
  );

describe("credential cipher", () => {
  it.effect("seal → open round-trips the secret", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault;
      const api = buildApi(vault);
      const secret = { p12Base64: "AAAA", p12Password: "hunter2" };
      const session = yield* openSession(api, vault.identity.privateKey);

      const env = yield* sealForUpload({
        session,
        credentialType: "distribution-certificate",
        metadata: { serialNumber: "ABC123" },
        secret,
      });

      const opened = yield* openFromDownload({
        session,
        credentialType: "distribution-certificate",
        downloaded: {
          id: env.id,
          ciphertext: env.ciphertext,
          wrappedDek: env.wrappedDek,
          vaultVersion: env.vaultVersion,
          serialNumber: "ABC123",
        },
      });

      expect(opened).toStrictEqual(secret);
    }),
  );

  it.effect("a flipped ciphertext byte fails the integrity check", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault;
      const api = buildApi(vault);
      const session = yield* openSession(api, vault.identity.privateKey);

      const env = yield* sealForUpload({
        session,
        credentialType: "push-key",
        metadata: { keyId: "ABCDE12345" },
        secret: { p8Pem: "pem" },
      });

      const tampered = fromBase64(env.ciphertext);
      const lastIndex = tampered.length - 1;
      // Flip the final byte without bitwise ops (lint bans them in this repo).
      tampered[lastIndex] = 255 - (tampered[lastIndex] ?? 0);

      const result = yield* Effect.either(
        openFromDownload({
          session,
          credentialType: "push-key",
          downloaded: {
            id: env.id,
            ciphertext: toBase64(tampered),
            wrappedDek: env.wrappedDek,
            vaultVersion: env.vaultVersion,
            keyId: "ABCDE12345",
          },
        }),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );

  it.effect("opening under a different credentialId fails", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault;
      const api = buildApi(vault);
      const session = yield* openSession(api, vault.identity.privateKey);

      const env = yield* sealForUpload({
        session,
        credentialType: "keystore",
        metadata: { keyAlias: "upload" },
        secret: { keystoreBase64: "AAAA", keystorePassword: "p", keyPassword: "k" },
      });

      const result = yield* Effect.either(
        openFromDownload({
          session,
          credentialType: "keystore",
          downloaded: {
            id: "a-different-id",
            ciphertext: env.ciphertext,
            wrappedDek: env.wrappedDek,
            vaultVersion: env.vaultVersion,
            keyAlias: "upload",
          },
        }),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("IdentityError");
      }
    }),
  );
});
