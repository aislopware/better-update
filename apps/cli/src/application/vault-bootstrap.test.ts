import { generateIdentity, unwrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { bootstrapVault } from "./vault-bootstrap";

import type { ApiClient } from "../services/api-client";

interface RegisterPayload {
  readonly kind: string;
  readonly publicKey: string;
  readonly label: string;
  readonly fingerprint: string;
}
interface WrapRow {
  readonly userEncryptionKeyId: string;
  readonly wrappedKey: string;
}
interface EnvWrapRow {
  readonly recipientKind: string;
  readonly recipientId: string;
  readonly wrappedKey: string;
}
interface Captured {
  recovery?: RegisterPayload;
  wraps?: readonly WrapRow[];
  envWraps?: readonly EnvWrapRow[];
}

/** Mock client that records the recovery registration + the bootstrap wrap rows. */
const buildApi = (captured: Captured): ApiClient =>
  ({
    userEncryptionKeys: {
      register: (req: { payload: RegisterPayload }) => {
        captured.recovery = req.payload;
        return Effect.succeed({ id: "recovery-key-id" });
      },
    },
    orgVault: {
      bootstrap: (req: {
        payload: { wraps: readonly WrapRow[]; envWraps: readonly EnvWrapRow[] };
      }) => {
        captured.wraps = req.payload.wraps;
        captured.envWraps = req.payload.envWraps;
        return Effect.succeed({ vaultVersion: 1 });
      },
    },
  }) as unknown as ApiClient;

describe(bootstrapVault, () => {
  it.effect("registers a recovery recipient and posts a device + recovery wrap row", () =>
    Effect.gen(function* () {
      const device = yield* Effect.promise(async () => generateIdentity());
      const captured: Captured = {};

      const result = yield* bootstrapVault({
        api: buildApi(captured),
        deviceKeyId: "device-key-id",
        deviceRecipient: device.publicKey,
      });

      expect(captured.recovery?.kind).toBe("recovery");
      expect(result.vaultVersion).toBe(1);
      expect((captured.wraps ?? []).map((wrap) => wrap.userEncryptionKeyId)).toStrictEqual([
        "device-key-id",
        "recovery-key-id",
      ]);
    }),
  );

  it.effect("both wrap rows decrypt back to the returned vault key", () =>
    Effect.gen(function* () {
      const device = yield* Effect.promise(async () => generateIdentity());
      const captured: Captured = {};

      const result = yield* bootstrapVault({
        api: buildApi(captured),
        deviceKeyId: "device-key-id",
        deviceRecipient: device.publicKey,
      });

      const [deviceWrap, recoveryWrap] = captured.wraps ?? [];
      if (!deviceWrap || !recoveryWrap) {
        throw new Error("bootstrap should post exactly two wrap rows");
      }

      const fromDevice = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(deviceWrap.wrappedKey),
          privateKey: device.privateKey,
        }),
      );
      const fromRecovery = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(recoveryWrap.wrappedKey),
          privateKey: result.recoveryPrivateKey,
        }),
      );

      expect(toBase64(fromDevice)).toBe(toBase64(result.vaultKey));
      expect(toBase64(fromRecovery)).toBe(toBase64(result.vaultKey));
    }),
  );

  it.effect("born-forks a SEPARATE env key wrapped to the device + recovery recipients", () =>
    Effect.gen(function* () {
      const device = yield* Effect.promise(async () => generateIdentity());
      const captured: Captured = {};

      const result = yield* bootstrapVault({
        api: buildApi(captured),
        deviceKeyId: "device-key-id",
        deviceRecipient: device.publicKey,
      });

      const env = captured.envWraps ?? [];
      expect(env.map((wrap) => wrap.recipientKind)).toStrictEqual(["device", "recovery"]);
      expect(env.map((wrap) => wrap.recipientId)).toStrictEqual([
        "device-key-id",
        "recovery-key-id",
      ]);

      const [envDevice, envRecovery] = env;
      if (!envDevice || !envRecovery) {
        throw new Error("bootstrap should post exactly two env wrap rows");
      }
      const envKeyFromDevice = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(envDevice.wrappedKey),
          privateKey: device.privateKey,
        }),
      );
      const envKeyFromRecovery = yield* Effect.promise(async () =>
        unwrapVaultKey({
          wrapped: fromBase64(envRecovery.wrappedKey),
          privateKey: result.recoveryPrivateKey,
        }),
      );

      // Both env wraps open to the SAME env key...
      expect(toBase64(envKeyFromDevice)).toBe(toBase64(envKeyFromRecovery));
      // ...which MUST be distinct from the credentials vault key — reusing it would
      // let a credentials-only recipient derive the env key (the isolation invariant).
      expect(toBase64(envKeyFromDevice)).not.toBe(toBase64(result.vaultKey));
    }),
  );
});
