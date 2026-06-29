import { fromBase64, toBase64 } from "@better-update/encoding";
import { randomBytes } from "@noble/ciphers/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateIdentity as ageGenerateIdentity, identityToRecipient } from "age-encryption";

import { aeadDecrypt, aeadEncrypt, encodeAad, fingerprint } from "./aead";
import { deriveKek, SALT_BYTES } from "./identity";

import type { Argon2Params } from "./identity";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Argon2id cost for the ACCOUNT escrow. Deliberately heavier than the on-disk
 * identity default (`DEFAULT_ARGON2_PARAMS`, ~64 MiB): the escrow blob is stored
 * server-side, so it is more exposed than a local `identity.json` and warrants a
 * costlier KDF. ~128 MiB. The params live in the envelope, so an enrollment can be
 * re-tuned without a format change — validate pure-JS Argon2id perf in the browser
 * before raising this. See docs/specs/build/11-two-vault-split-and-web-env-crud.md §3.2.
 */
export const ACCOUNT_ARGON2_PARAMS: Argon2Params = { time: 3, memory: 131_072, parallelism: 1 };

/**
 * A per-user account keypair. `agePrivateKey`/`agePublicKey` is the X25519 age key
 * (`AGE-SECRET-KEY-…` / `age1…`) — the env-vault recipient the browser unwraps with
 * after unsealing the escrow. `ed25519PrivateKey`/`ed25519PublicKey` (base64, 32-byte
 * seed + public key) is reserved for the (deferred) signed-roster / signed-head
 * integrity layer (spec §8), generated up front so adding it later needs no
 * re-enrollment. `fingerprint` is the `SHA256:` of the age recipient.
 */
export interface AccountKeyMaterial {
  agePrivateKey: string;
  agePublicKey: string;
  ed25519PrivateKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
}

/**
 * The server-stored escrow envelope. It seals the account's PRIVATE keys
 * (`{agePrivateKey, ed25519PrivateKey}` JSON, in `ct`) under the user's passphrase
 * (Argon2id → KEK → XChaCha20-Poly1305, the header bound as AAD), mirroring
 * `IdentityFile` but stored server-side rather than on disk. `salt` is base64 and
 * independent of the device-identity salt. The server holds the whole envelope
 * opaquely and can never open it (no passphrase).
 */
export interface AccountKeyEnvelope {
  version: 1;
  agePublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  kdf: "argon2id";
  kdfParams: Argon2Params;
  salt: string;
  cipher: "xchacha20poly1305";
  ct: string;
}

/** The private halves sealed inside {@link AccountKeyEnvelope.ct}. */
interface SealedAccountSecret {
  agePrivateKey: string;
  ed25519PrivateKey: string;
}

/** Narrow a decrypted escrow payload to {@link SealedAccountSecret} without an unsafe cast. */
const isSealedAccountSecret = (value: unknown): value is SealedAccountSecret =>
  typeof value === "object" &&
  value !== null &&
  "agePrivateKey" in value &&
  typeof value.agePrivateKey === "string" &&
  "ed25519PrivateKey" in value &&
  typeof value.ed25519PrivateKey === "string";

/** Generate a fresh account keypair: an age X25519 key plus an Ed25519 signing key. */
export const generateAccountKey = async (): Promise<AccountKeyMaterial> => {
  const agePrivateKey = await ageGenerateIdentity();
  const agePublicKey = await identityToRecipient(agePrivateKey);
  const ed = ed25519.keygen();
  return {
    agePrivateKey,
    agePublicKey,
    ed25519PrivateKey: toBase64(ed.secretKey),
    ed25519PublicKey: toBase64(ed.publicKey),
    fingerprint: fingerprint(agePublicKey),
  };
};

const escrowAad = (
  header: Pick<
    AccountKeyEnvelope,
    "agePublicKey" | "ed25519PublicKey" | "fingerprint" | "kdfParams"
  >,
): Uint8Array =>
  encodeAad("better-update/account-key", [
    header.agePublicKey,
    header.ed25519PublicKey,
    header.fingerprint,
    header.kdfParams.time,
    header.kdfParams.memory,
    header.kdfParams.parallelism,
  ]);

/** Seal an account keypair into its escrow envelope with a passphrase. */
export const sealAccountKey = (args: {
  material: AccountKeyMaterial;
  passphrase: string;
  kdfParams?: Argon2Params;
}): AccountKeyEnvelope => {
  const kdfParams = args.kdfParams ?? ACCOUNT_ARGON2_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const kek = deriveKek(args.passphrase, salt, kdfParams);
  const header = {
    agePublicKey: args.material.agePublicKey,
    ed25519PublicKey: args.material.ed25519PublicKey,
    fingerprint: args.material.fingerprint,
    kdfParams,
  };
  const secret: SealedAccountSecret = {
    agePrivateKey: args.material.agePrivateKey,
    ed25519PrivateKey: args.material.ed25519PrivateKey,
  };
  const ct = aeadEncrypt(kek, textEncoder.encode(JSON.stringify(secret)), escrowAad(header));
  return {
    version: 1,
    agePublicKey: header.agePublicKey,
    ed25519PublicKey: header.ed25519PublicKey,
    fingerprint: header.fingerprint,
    kdf: "argon2id",
    kdfParams,
    salt: toBase64(salt),
    cipher: "xchacha20poly1305",
    ct: toBase64(ct),
  };
};

/**
 * Open an account escrow envelope. Throws (propagated AEAD failure) on a wrong
 * passphrase or a tampered envelope — the seal binds both public keys, the
 * fingerprint, and the KDF params as AAD. The returned public halves are
 * **re-derived from the decrypted private keys**, so they always match the keys
 * they unlock (mirrors `openIdentity`).
 */
export const openAccountKey = async (args: {
  envelope: AccountKeyEnvelope;
  passphrase: string;
}): Promise<AccountKeyMaterial> => {
  const { envelope } = args;
  const kek = deriveKek(args.passphrase, fromBase64(envelope.salt), envelope.kdfParams);
  const plaintext = aeadDecrypt(kek, fromBase64(envelope.ct), escrowAad(envelope));
  const parsed: unknown = JSON.parse(textDecoder.decode(plaintext));
  if (!isSealedAccountSecret(parsed)) {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- crypto leaf lib surfaces an integrity/shape failure as an exception (mirrors aeadDecrypt/openIdentity); callers wrap in Effect.tryPromise
    throw new Error("Account escrow payload has an unexpected shape.");
  }
  const secret = parsed;
  const agePublicKey = await identityToRecipient(secret.agePrivateKey);
  const ed25519PublicKey = toBase64(ed25519.getPublicKey(fromBase64(secret.ed25519PrivateKey)));
  return {
    agePrivateKey: secret.agePrivateKey,
    agePublicKey,
    ed25519PrivateKey: secret.ed25519PrivateKey,
    ed25519PublicKey,
    fingerprint: fingerprint(agePublicKey),
  };
};
