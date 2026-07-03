import {
  generateIdentity,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { IdentityFile } from "@better-update/credentials-crypto";

import { InteractiveModeLive } from "../lib/interactive-mode";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { rotateEnvVault } from "./env-vault-rotation";

import type { ApiClient } from "../services/api-client";

interface EnvWrapRow {
  readonly recipientKind: string;
  readonly recipientId: string;
  readonly wrappedKey: string;
}

interface RotatePayload {
  readonly fromVersion: number;
  readonly wraps: readonly EnvWrapRow[];
  readonly envDeks: readonly unknown[];
}

interface StubKey {
  readonly id: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly kind: string;
  readonly label: string;
}

const cliRuntimeStub = (env: Readonly<Record<string, string | undefined>>) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux",
    cwd: Effect.succeed("/"),
    getEnv: (name: string) => Effect.succeed(env[name]),
    homeDirectory: Effect.succeed("/"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

const identityStoreStub = (initial: IdentityFile | null) =>
  Layer.succeed(IdentityStore, {
    load: Effect.sync(() => initial),
    save: () => Effect.void,
    clear: Effect.void,
  });

describe("rotating the env vault with an excluded recipient", () => {
  it.effect("re-wraps every survivor but never the excluded machine key", () =>
    Effect.gen(function* () {
      // The caller is a machine identity (BETTER_UPDATE_IDENTITY), itself an env
      // recipient; the revoked robot and an offline recovery key are the others.
      const caller = yield* Effect.promise(async () => generateIdentity());
      const revokedRobot = yield* Effect.promise(async () => generateIdentity());
      const recovery = yield* Effect.promise(async () => generateIdentity());
      const envKey = generateVaultKey();
      const callerWrap = yield* Effect.promise(async () =>
        wrapVaultKey({ vaultKey: envKey, recipient: caller.publicKey }),
      );

      const keys: readonly StubKey[] = [
        {
          id: "key-caller",
          publicKey: caller.publicKey,
          fingerprint: caller.fingerprint,
          kind: "machine",
          label: "admin machine",
        },
        {
          id: "key-robot",
          publicKey: revokedRobot.publicKey,
          fingerprint: revokedRobot.fingerprint,
          kind: "machine",
          label: "revoked robot",
        },
        {
          id: "key-recovery",
          publicKey: recovery.publicKey,
          fingerprint: recovery.fingerprint,
          kind: "recovery",
          label: "recovery",
        },
      ];

      const captured: RotatePayload[] = [];
      const api = {
        me: {
          get: () => Effect.succeed({ activeOrganization: { id: "org-1" } }),
        },
        orgVault: {
          get: () => Effect.succeed({ envVaultCutoverAt: "2026-01-01T00:00:00Z" }),
        },
        userEncryptionKeys: {
          list: () => Effect.succeed({ items: keys }),
        },
        accountKeys: {
          list: () => Effect.succeed({ items: [] }),
        },
        envVault: {
          getWrap: () => Effect.succeed({ envVaultVersion: 3, wrappedKey: toBase64(callerWrap) }),
          listWraps: () =>
            Effect.succeed({
              envVaultVersion: 3,
              recipients: [
                { recipientKind: "machine", recipientId: "key-caller", createdAt: "" },
                { recipientKind: "machine", recipientId: "key-robot", createdAt: "" },
                { recipientKind: "recovery", recipientId: "key-recovery", createdAt: "" },
              ],
            }),
          listCredentialDeks: () => Effect.succeed({ envVaultVersion: 3, deks: [] }),
          rotate: ({ payload }: { readonly payload: RotatePayload }) => {
            captured.push(payload);
            return Effect.succeed({ envVaultVersion: payload.fromVersion + 1 });
          },
        },
      } as unknown as ApiClient;

      const rotated = yield* rotateEnvVault(api, { excludeKeyId: "key-robot" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            cliRuntimeStub({ BETTER_UPDATE_IDENTITY: caller.privateKey }),
            identityStoreStub(null),
            InteractiveModeLive,
          ),
        ),
      );

      expect(rotated.envVaultVersion).toBe(4);
      expect(captured).toHaveLength(1);
      const [payload] = captured;
      expect(payload?.fromVersion).toBe(3);

      // The robot never receives the new key; caller + recovery survive.
      const wrappedIds = payload?.wraps.map((wrap) => wrap.recipientId).toSorted();
      expect(wrappedIds).toStrictEqual(["key-caller", "key-recovery"]);

      // Survivors can actually open the rotated key with their private halves.
      const callerRow = payload?.wraps.find((wrap) => wrap.recipientId === "key-caller");
      const newKey = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(callerRow?.wrappedKey ?? ""),
          privateKey: caller.privateKey,
        }),
      );
      expect(newKey).toHaveLength(envKey.length);
    }),
  );

  it.effect("re-wraps the full recipient set when nothing is excluded", () =>
    Effect.gen(function* () {
      const caller = yield* Effect.promise(async () => generateIdentity());
      const recovery = yield* Effect.promise(async () => generateIdentity());
      const envKey = generateVaultKey();
      const callerWrap = yield* Effect.promise(async () =>
        wrapVaultKey({ vaultKey: envKey, recipient: caller.publicKey }),
      );
      const captured: RotatePayload[] = [];
      const api = {
        me: { get: () => Effect.succeed({ activeOrganization: { id: "org-1" } }) },
        orgVault: { get: () => Effect.succeed({ envVaultCutoverAt: "2026-01-01T00:00:00Z" }) },
        userEncryptionKeys: {
          list: () =>
            Effect.succeed({
              items: [
                {
                  id: "key-caller",
                  publicKey: caller.publicKey,
                  fingerprint: caller.fingerprint,
                  kind: "machine",
                  label: "admin machine",
                },
                {
                  id: "key-recovery",
                  publicKey: recovery.publicKey,
                  fingerprint: recovery.fingerprint,
                  kind: "recovery",
                  label: "recovery",
                },
              ],
            }),
        },
        accountKeys: { list: () => Effect.succeed({ items: [] }) },
        envVault: {
          getWrap: () => Effect.succeed({ envVaultVersion: 1, wrappedKey: toBase64(callerWrap) }),
          listWraps: () =>
            Effect.succeed({
              envVaultVersion: 1,
              recipients: [
                { recipientKind: "machine", recipientId: "key-caller", createdAt: "" },
                { recipientKind: "recovery", recipientId: "key-recovery", createdAt: "" },
              ],
            }),
          listCredentialDeks: () => Effect.succeed({ envVaultVersion: 1, deks: [] }),
          rotate: ({ payload }: { readonly payload: RotatePayload }) => {
            captured.push(payload);
            return Effect.succeed({ envVaultVersion: payload.fromVersion + 1 });
          },
        },
      } as unknown as ApiClient;

      yield* rotateEnvVault(api).pipe(
        Effect.provide(
          Layer.mergeAll(
            cliRuntimeStub({ BETTER_UPDATE_IDENTITY: caller.privateKey }),
            identityStoreStub(null),
            InteractiveModeLive,
          ),
        ),
      );

      expect(captured[0]?.wraps.map((wrap) => wrap.recipientId).toSorted()).toStrictEqual([
        "key-caller",
        "key-recovery",
      ]);
    }),
  );
});
