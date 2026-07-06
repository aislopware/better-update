import { Conflict, NotFound } from "@better-update/api";
import {
  generateIdentity,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { InteractiveModeLive } from "../lib/interactive-mode";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";
import { grantEnvRecipient, grantEnvRecipientIdempotent, orgHasCutOver } from "./env-vault-access";

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

describe("granting an env recipient idempotently", () => {
  // The caller is a machine identity (BETTER_UPDATE_IDENTITY), itself an env
  // recipient at version 5, granting a member's device key.
  const setup = Effect.gen(function* () {
    const caller = yield* Effect.promise(async () => generateIdentity());
    const device = yield* Effect.promise(async () => generateIdentity());
    const envKey = generateVaultKey();
    const callerWrap = yield* Effect.promise(async () =>
      wrapVaultKey({ vaultKey: envKey, recipient: caller.publicKey }),
    );
    const target = {
      id: "key-device",
      publicKey: device.publicKey,
      fingerprint: device.fingerprint,
      kind: "device",
      label: "member device",
    } as unknown as UserEncryptionKey;
    return { caller, device, envKey, callerWrap, target };
  });

  const layers = (callerPrivateKey: string) => {
    const env: Readonly<Record<string, string | undefined>> = {
      BETTER_UPDATE_IDENTITY: callerPrivateKey,
      BETTER_UPDATE_NO_CACHE: "1",
    };
    return Layer.mergeAll(
      Layer.succeed(CliRuntime, {
        argv: [],
        platform: "linux",
        cwd: Effect.succeed("/"),
        getEnv: (name: string) => Effect.succeed(env[name]),
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
      InteractiveModeLive,
    );
  };

  interface IdempotentApiStub {
    readonly addWrap: (payload: EnvAddWrapPayload) => Effect.Effect<unknown, Conflict>;
    readonly wrappedRecipientIds?: readonly string[];
  }

  const buildIdempotentApi = (
    fixture: { readonly caller: { publicKey: string }; readonly callerWrap: Uint8Array },
    stub: IdempotentApiStub,
  ): ApiClient =>
    ({
      userEncryptionKeys: {
        list: () =>
          Effect.succeed({
            items: [
              {
                id: "key-caller",
                publicKey: fixture.caller.publicKey,
                kind: "machine",
                label: "admin machine",
              },
            ],
          }),
      },
      envVault: {
        getWrap: () =>
          Effect.succeed({ envVaultVersion: 5, wrappedKey: toBase64(fixture.callerWrap) }),
        addWrap: ({ payload }: { readonly payload: EnvAddWrapPayload }) => stub.addWrap(payload),
        listWraps: () =>
          Effect.succeed({
            envVaultVersion: 5,
            recipients: (stub.wrappedRecipientIds ?? []).map((recipientId) => ({
              recipientKind: "device",
              recipientId,
              createdAt: "",
            })),
          }),
      },
    }) as unknown as ApiClient;

  it.effect("wraps the env key to the target and reports it granted", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const captured: EnvAddWrapPayload[] = [];
      const api = buildIdempotentApi(fixture, {
        addWrap: (payload) => {
          captured.push(payload);
          return Effect.succeed({});
        },
      });

      const outcome = yield* grantEnvRecipientIdempotent(api, fixture.target).pipe(
        Effect.provide(layers(fixture.caller.privateKey)),
      );

      expect(outcome).toBe("granted");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.wrap.recipientKind).toBe("device");
      expect(captured[0]?.wrap.recipientId).toBe("key-device");
      const unwrapped = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(captured[0]?.wrap.wrappedKey ?? ""),
          privateKey: fixture.device.privateKey,
        }),
      );
      expect(unwrapped).toStrictEqual(fixture.envKey);
    }),
  );

  it.effect("reports an existing wrap behind a Conflict as already granted", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      let attempts = 0;
      const api = buildIdempotentApi(fixture, {
        addWrap: () => {
          attempts += 1;
          return Effect.fail(new Conflict({ message: "wrap exists" }));
        },
        wrappedRecipientIds: ["key-device"],
      });

      const outcome = yield* grantEnvRecipientIdempotent(api, fixture.target).pipe(
        Effect.provide(layers(fixture.caller.privateKey)),
      );

      expect(outcome).toBe("already");
      expect(attempts).toBe(1);
    }),
  );

  it.effect("retries a stale-version Conflict when no wrap actually exists", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      let attempts = 0;
      const api = buildIdempotentApi(fixture, {
        addWrap: () => {
          attempts += 1;
          return attempts === 1
            ? Effect.fail(new Conflict({ message: "stale env vault version" }))
            : Effect.succeed({});
        },
      });

      const outcome = yield* grantEnvRecipientIdempotent(api, fixture.target).pipe(
        Effect.provide(layers(fixture.caller.privateKey)),
      );

      expect(outcome).toBe("granted");
      expect(attempts).toBe(2);
    }),
  );
});
