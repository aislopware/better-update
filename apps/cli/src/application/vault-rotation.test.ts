import {
  generateDek,
  generateIdentity,
  generateVaultKey,
  unwrapDek,
  unwrapVaultKey,
  wrapDek,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { Identity } from "@better-update/credentials-crypto";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { rotateVaultTo } from "./vault-rotation";

import type { ApiClient } from "../services/api-client";

const ORG_ID = "org-1";
const CRED_ID = "cred-1";
const KEY_ID = "key-1";

interface RotatePayload {
  readonly fromVersion: number;
  readonly recipientWraps: readonly { userEncryptionKeyId: string; wrappedKey: string }[];
  readonly credentialDeks: readonly { credentialId: string; wrappedDek: string }[];
}

const vaultLayer = (privateKey: string) =>
  Layer.mergeAll(
    makeInteractiveModeLayer(false),
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
    }),
    Layer.succeed(IdentityStore, {
      load: Effect.sync(() => null),
      save: () => Effect.void,
      clear: Effect.void,
    }),
  );

describe(rotateVaultTo, () => {
  it.effect("re-keys every DEK under a new vault key wrapped to the recipients", () =>
    Effect.gen(function* () {
      const identity: Identity = yield* Effect.promise(async () => generateIdentity());
      const oldVaultKey = generateVaultKey();
      const wrappedVaultKey = toBase64(
        yield* Effect.promise(async () =>
          wrapVaultKey({ vaultKey: oldVaultKey, recipient: identity.publicKey }),
        ),
      );
      // A credential DEK wrapped under the OLD vault key at version 1.
      const originalDek = generateDek();
      const wrappedDekV1 = toBase64(
        wrapDek({
          dek: originalDek,
          vaultKey: oldVaultKey,
          binding: { orgId: ORG_ID, credentialId: CRED_ID, vaultVersion: 1 },
        }),
      );

      let captured: RotatePayload | undefined;
      const api = {
        me: { get: () => Effect.succeed({ activeOrganization: { id: ORG_ID } }) },
        userEncryptionKeys: {
          list: () =>
            Effect.succeed({
              items: [
                {
                  id: KEY_ID,
                  publicKey: identity.publicKey,
                  fingerprint: identity.fingerprint,
                  kind: "device",
                  label: "ci",
                },
              ],
            }),
        },
        orgVault: {
          getWrap: () => Effect.succeed({ vaultVersion: 1, wrappedKey: wrappedVaultKey }),
          listCredentialDeks: () =>
            Effect.succeed({
              vaultVersion: 1,
              deks: [
                {
                  credentialType: "androidUploadKeystore",
                  credentialId: CRED_ID,
                  wrappedDek: wrappedDekV1,
                  vaultVersion: 1,
                },
              ],
            }),
          rotate: ({ payload }: { payload: RotatePayload }) => {
            captured = payload;
            return Effect.succeed({
              organizationId: ORG_ID,
              vaultVersion: payload.fromVersion + 1,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            });
          },
        },
      } as unknown as ApiClient;

      const rotated = yield* rotateVaultTo({
        api,
        passphrase: undefined,
        recipients: [{ userEncryptionKeyId: KEY_ID, publicKey: identity.publicKey }],
      }).pipe(Effect.provide(vaultLayer(identity.privateKey)));

      expect(rotated.vaultVersion).toBe(2);
      expect(captured?.fromVersion).toBe(1);
      expect(captured?.recipientWraps).toHaveLength(1);
      expect(captured?.credentialDeks).toHaveLength(1);

      // The rotation must be self-consistent: unwrap the new vault key from the
      // recipient wrap, then unwrap the re-wrapped DEK under it (bound to v2) and
      // confirm it recovers the original DEK.
      const wrap = captured?.recipientWraps[0];
      const dek = captured?.credentialDeks[0];
      const newVaultKey = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(wrap?.wrappedKey ?? ""),
          privateKey: identity.privateKey,
        }),
      );
      const recovered = unwrapDek({
        wrappedDek: fromBase64(dek?.wrappedDek ?? ""),
        vaultKey: newVaultKey,
        binding: { orgId: ORG_ID, credentialId: CRED_ID, vaultVersion: 2 },
      });
      expect(toBase64(recovered)).toBe(toBase64(originalDek));
    }),
  );
});
