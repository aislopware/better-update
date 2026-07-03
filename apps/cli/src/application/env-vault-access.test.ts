import { NotFound } from "@better-update/api";
import {
  generateIdentity,
  generateVaultKey,
  unwrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { grantEnvRecipient, orgHasCutOver } from "./env-vault-access";

import type { ApiClient } from "../services/api-client";

interface EnvAddWrapPayload {
  readonly envVaultVersion: number;
  readonly wrap: {
    readonly recipientKind: string;
    readonly recipientId: string;
    readonly wrappedKey: string;
  };
}

const buildApi = (stub: {
  readonly cutoverAt?: string | null;
  readonly captured?: EnvAddWrapPayload[];
}): ApiClient =>
  ({
    orgVault: {
      get: () =>
        stub.cutoverAt === undefined
          ? Effect.fail(new NotFound({ message: "Vault not initialized" }))
          : Effect.succeed({ envVaultCutoverAt: stub.cutoverAt }),
    },
    envVault: {
      addWrap: ({ payload }: { readonly payload: EnvAddWrapPayload }) => {
        stub.captured?.push(payload);
        return Effect.succeed({});
      },
    },
  }) as unknown as ApiClient;

describe("checking the env cutover state", () => {
  it.effect("is true once the org has forked its env vault", () =>
    Effect.gen(function* () {
      expect(yield* orgHasCutOver(buildApi({ cutoverAt: "2026-01-01T00:00:00Z" }))).toBe(true);
    }),
  );

  it.effect("is false while env still lives in the credentials vault", () =>
    Effect.gen(function* () {
      expect(yield* orgHasCutOver(buildApi({ cutoverAt: null }))).toBe(false);
    }),
  );

  it.effect("is false when the org has no vault at all", () =>
    Effect.gen(function* () {
      expect(yield* orgHasCutOver(buildApi({}))).toBe(false);
    }),
  );
});

describe("granting an env recipient", () => {
  it.effect("wraps the env key to a machine recipient so the robot can open it", () =>
    Effect.gen(function* () {
      const robot = yield* Effect.promise(async () => generateIdentity());
      const envKey = generateVaultKey();
      const captured: EnvAddWrapPayload[] = [];
      const api = buildApi({ cutoverAt: "2026-01-01T00:00:00Z", captured });
      const target = {
        id: "robot-key-1",
        publicKey: robot.publicKey,
        fingerprint: robot.fingerprint,
        kind: "machine",
        label: "ci robot",
      } as unknown as UserEncryptionKey;

      yield* grantEnvRecipient({
        api,
        vault: { vaultKey: envKey, vaultVersion: 5, keyId: "self" },
        target,
      });

      // The wrap row targets the machine key at the version we unlocked from
      // (the server CAS-rejects it if the env vault rotated underneath).
      expect(captured).toHaveLength(1);
      const [payload] = captured;
      expect(payload?.envVaultVersion).toBe(5);
      expect(payload?.wrap.recipientKind).toBe("machine");
      expect(payload?.wrap.recipientId).toBe("robot-key-1");

      // Only the robot's private key opens the wrap — and it yields the env key.
      const unwrapped = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(payload?.wrap.wrappedKey ?? ""),
          privateKey: robot.privateKey,
        }),
      );
      expect(unwrapped).toStrictEqual(envKey);
    }),
  );
});
