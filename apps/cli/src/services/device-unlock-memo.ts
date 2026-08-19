import { Context, Effect, Layer, Ref } from "effect";

import type { UnlockedDeviceIdentity } from "../application/vault-access";

/**
 * Process-scoped memo of this device's unlocked identity — the in-memory tier
 * above the OS-keychain vault cache (services/vault-cache.ts).
 *
 * The keychain caches an unwrapped VAULT key, one entry per (org, recipient,
 * vault kind), so it cannot help the FIRST time a command touches a given vault:
 * `credentials access grant` unlocks the credentials vault and then the env
 * vault, `credentials account create` verifies the passphrase and then unlocks
 * the env vault, and a build reads credentials before env values — each pair
 * missed the cache independently and asked for the same passphrase twice.
 *
 * This memo closes that gap for the lifetime of ONE command: the passphrase is
 * prompted once, Argon2id runs once, and every later unlock in the same run
 * reuses the opened identity. It is keyed by public key so a replaced identity
 * file is never opened with a stale entry.
 *
 * Nothing is persisted — the layer holds the only reference and dies with the
 * process, so unlike the keychain tier there is no at-rest exposure to weigh.
 */
export class DeviceUnlockMemo extends Context.Service<
  DeviceUnlockMemo,
  {
    /** The identity unlocked earlier in this run for `publicKey`, or `undefined`. */
    readonly get: (publicKey: string) => Effect.Effect<UnlockedDeviceIdentity | undefined>;
    /** Remember an identity that was just opened (and thereby verified). */
    readonly set: (
      publicKey: string,
      unlocked: UnlockedDeviceIdentity,
    ) => Effect.Effect<UnlockedDeviceIdentity>;
  }
>()("cli/DeviceUnlockMemo") {}

interface MemoEntry {
  readonly publicKey: string;
  readonly unlocked: UnlockedDeviceIdentity;
}

export const DeviceUnlockMemoLive = Layer.effect(
  DeviceUnlockMemo,
  Effect.gen(function* () {
    const entry = yield* Ref.make<MemoEntry | null>(null);
    return {
      get: (publicKey) =>
        Ref.get(entry).pipe(
          Effect.map((held) => (held?.publicKey === publicKey ? held.unlocked : undefined)),
        ),
      set: (publicKey, unlocked) =>
        Ref.set(entry, { publicKey, unlocked }).pipe(Effect.as(unlocked)),
    };
  }),
);
