import {
  openAccountKey,
  openIdentity,
  sealAccountKey,
  sealIdentity,
} from "@better-update/credentials-crypto";
import { Effect, Either } from "effect";

import type { AccountKeyEnvelope } from "@better-update/credentials-crypto";

import { IdentityError } from "../lib/exit-codes";
import { IdentityStore } from "../services/identity-store";
import { loadIdentityFileOrFail } from "./identity";

import type { ApiClient } from "../services/api-client";

/** What happened to the (shared, per-user) account escrow during a passphrase change. */
export type AccountResealOutcome = "resealed" | "absent" | "passphrase-mismatch" | "error";

/** Rebuild the {@link AccountKeyEnvelope} from the server escrow view (escrowCt → ct). */
export const escrowToEnvelope = (escrow: {
  readonly version: 1;
  readonly agePublicKey: string;
  readonly ed25519PublicKey: string;
  readonly fingerprint: string;
  readonly kdf: "argon2id";
  readonly kdfParams: {
    readonly time: number;
    readonly memory: number;
    readonly parallelism: number;
  };
  readonly salt: string;
  readonly cipher: "xchacha20poly1305";
  readonly escrowCt: string;
}): AccountKeyEnvelope => ({
  version: escrow.version,
  agePublicKey: escrow.agePublicKey,
  ed25519PublicKey: escrow.ed25519PublicKey,
  fingerprint: escrow.fingerprint,
  kdf: escrow.kdf,
  kdfParams: escrow.kdfParams,
  salt: escrow.salt,
  cipher: escrow.cipher,
  ct: escrow.escrowCt,
});

/**
 * Re-seal the caller's account-key escrow under `newPassphrase`. BEST-EFFORT and
 * total: it never fails the surrounding flow — it reports an {@link
 * AccountResealOutcome} so the caller can warn. This matters because the account
 * escrow is a single per-USER secret shared across every device, while device
 * identities are per-device: another device may already have moved the escrow to a
 * different passphrase, so opening it with THIS device's old passphrase can
 * legitimately fail (`passphrase-mismatch`) without blocking the device change.
 */
export const resealAccountKey = (
  api: ApiClient,
  oldPassphrase: string,
  newPassphrase: string,
): Effect.Effect<AccountResealOutcome> =>
  Effect.gen(function* () {
    const escrowResult = yield* api.accountKeys.getMe().pipe(Effect.either);
    if (Either.isLeft(escrowResult)) {
      return escrowResult.left._tag === "NotFound" ? "absent" : "error";
    }
    const materialResult = yield* Effect.tryPromise(async () =>
      openAccountKey({ envelope: escrowToEnvelope(escrowResult.right), passphrase: oldPassphrase }),
    ).pipe(Effect.either);
    if (Either.isLeft(materialResult)) {
      return "passphrase-mismatch";
    }
    const next = sealAccountKey({ material: materialResult.right, passphrase: newPassphrase });
    const resealResult = yield* api.accountKeys
      .reseal({ payload: { kdfParams: next.kdfParams, salt: next.salt, escrowCt: next.ct } })
      .pipe(Effect.either);
    return Either.isLeft(resealResult) ? "error" : "resealed";
  });

/**
 * Change the device passphrase. The local device identity is the PRIMARY, and is
 * saved FIRST: it is purely local and authoritative for this device, so on success
 * the device is on the new passphrase regardless of what happens to the shared
 * account escrow. Ordering is deliberate — if the local save fails, nothing was
 * mutated (the server escrow is untouched); the account escrow re-seal then runs
 * best-effort and its {@link AccountResealOutcome} is returned for the caller to
 * surface, so a network/passphrase issue degrades to a warning, never a hard block
 * or a silent split. The vault keys are unchanged, so cached unlocks and every
 * wrap stay valid.
 */
export const changePassphrase = (
  api: ApiClient,
  params: { readonly oldPassphrase: string; readonly newPassphrase: string },
) =>
  Effect.gen(function* () {
    const store = yield* IdentityStore;
    const file = yield* loadIdentityFileOrFail;
    const identity = yield* Effect.tryPromise({
      try: async () => openIdentity({ file, passphrase: params.oldPassphrase }),
      catch: () =>
        new IdentityError({
          message: "Wrong current passphrase — could not unlock this device's identity.",
        }),
    });
    const nextFile = yield* Effect.promise(async () =>
      sealIdentity({ privateKey: identity.privateKey, passphrase: params.newPassphrase }),
    );
    yield* store.save(nextFile);
    const account = yield* resealAccountKey(api, params.oldPassphrase, params.newPassphrase);
    return { account };
  });
