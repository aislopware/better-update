/**
 * Tauri updater signatures — minisign, exactly as `tauri build` / `tauri
 * signer sign` write them (tauri-cli `updater_signature.rs` on minisign 0.9):
 *
 * - the archive is prehashed with BLAKE2b-512 and signed with Ed25519
 *   (algorithm `ED`), tagged with the key's 8-byte id;
 * - a global signature covers that signature and the trusted comment
 *   `timestamp:<unix>\tfile:<name>\tversion:<version>` — the version the
 *   updater plugin (2.13+) checks against the one the feed announces;
 * - the feed's `signature` is the base64 of the whole signature box text.
 *
 * `TAURI_SIGNING_PRIVATE_KEY` is base64 of a minisign secret-key box: the key
 * (id ‖ 64-byte Ed25519 secret ‖ BLAKE2b-256 checksum) XORed with an scrypt
 * stream of the password — an empty password still encrypts.
 */
import { createHash, scryptSync } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";

export interface TauriPrivateKey {
  readonly keyId: Uint8Array;
  /** Ed25519 seed (the first half of minisign's 64-byte secret key). */
  readonly seed: Uint8Array;
  readonly publicKey: Uint8Array;
}

export interface TauriPublicKey {
  readonly keyId: Uint8Array;
  readonly publicKey: Uint8Array;
}

const UNTRUSTED_PREFIX = "untrusted comment: ";
const TRUSTED_PREFIX = "trusted comment: ";
const SIGNATURE_COMMENT = "signature from tauri secret key";

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

/**
 * The second line of a minisign box, given the box text itself or the base64
 * of it (how Tauri passes keys and signatures around).
 */
const boxPayload = (text: string): Uint8Array | undefined => {
  const trimmed = text.trim();
  const boxText = trimmed.startsWith(UNTRUSTED_PREFIX)
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  const [comment, payload] = boxText.split(/\r?\n/u);
  return comment?.startsWith(UNTRUSTED_PREFIX) === true && payload !== undefined
    ? Buffer.from(payload.trim(), "base64")
    : undefined;
};

/** The smallest N exponent whose 2^N exceeds half of `maxN` (libsodium's loop). */
const exponentFor = (maxN: number) =>
  Array.from({ length: 62 }, (_, index) => index + 1).find(
    (candidate) => 2 ** candidate > maxN / 2,
  ) ?? 63;

export interface ScryptCost {
  readonly nLog2: number;
  readonly blockSize: number;
  readonly parallelism: number;
}

/** libsodium's `pickparams`: how minisign turns its stored limits into scrypt's N, r and p. */
export const minisignScryptParams = (opslimit: number, memlimit: number): ScryptCost => {
  const ops = Math.max(32_768, opslimit);
  const blockSize = 8;
  if (ops < memlimit / 32) {
    return { nLog2: exponentFor(ops / (blockSize * 4)), blockSize, parallelism: 1 };
  }
  const nLog2 = exponentFor(memlimit / (blockSize * 128));
  const maxrp = Math.min(0x3f_ff_ff_ff, Math.floor(ops / 4 / 2 ** nLog2));
  return { nLog2, blockSize, parallelism: Math.floor(maxrp / blockSize) };
};

/** minisign rejects stronger parameters than this, so a key file cannot demand gigabytes. */
const N_LOG2_MAX = 20;
const SECRET_KEY_BYTES = 158;
const KDF_SCRYPT = "Sc";
const KDF_NONE = "\u0000\u0000";

const xorBytes = (data: Uint8Array, stream: Uint8Array) =>
  // eslint-disable-next-line eslint-js/no-bitwise -- minisign's key encryption is an XOR with the scrypt stream
  data.map((byte, index) => byte ^ (stream[index] ?? 0));

/** The scrypt stream that seals the key, or zeros for an unencrypted key. */
const keyStream = (bytes: Uint8Array, kdf: string, password: string, length: number) => {
  const view = Buffer.from(bytes);
  const cost = minisignScryptParams(
    Number(view.readBigUInt64LE(38)),
    Number(view.readBigUInt64LE(46)),
  );
  if (kdf !== KDF_SCRYPT) {
    return new Uint8Array(length);
  }
  if (cost.nLog2 > N_LOG2_MAX) {
    return undefined;
  }
  const workFactor = 2 ** cost.nLog2;
  return scryptSync(Buffer.from(password, "utf8"), bytes.subarray(6, 38), length, {
    cost: workFactor,
    blockSize: cost.blockSize,
    parallelization: cost.parallelism,
    maxmem: 256 * workFactor * cost.blockSize * cost.parallelism + 1_048_576,
  });
};

/**
 * Decrypt a Tauri updater private key (box text, or base64 of it) with its
 * password, or say why it cannot be used.
 */
export const parseTauriPrivateKey = (text: string, password: string): TauriPrivateKey | string => {
  const bytes = boxPayload(text);
  if (bytes?.length !== SECRET_KEY_BYTES) {
    return "Not a Tauri updater private key (expected what `tauri signer generate` writes: base64 of a minisign secret key).";
  }
  const signatureAlgorithm = bytes.subarray(0, 2);
  const kdf = ascii(bytes.subarray(2, 4));
  if (ascii(signatureAlgorithm) !== "Ed" || ascii(bytes.subarray(4, 6)) !== "B2") {
    return "Unsupported Tauri key: expected an Ed25519 minisign key with a BLAKE2b checksum.";
  }
  if (kdf !== KDF_SCRYPT && kdf !== KDF_NONE) {
    return "Unsupported Tauri key encryption (minisign keys use scrypt).";
  }
  const sealed = bytes.subarray(54);
  const stream = keyStream(bytes, kdf, password, sealed.length);
  if (stream === undefined) {
    return "The Tauri key's scrypt parameters are too high.";
  }
  const opened = xorBytes(sealed, stream);
  const keyId = opened.subarray(0, 8);
  const secret = opened.subarray(8, 72);
  const expected = blake2b(Buffer.concat([signatureAlgorithm, keyId, secret]), { dkLen: 32 });
  if (!equalBytes(opened.subarray(72, 104), expected)) {
    return kdf === KDF_SCRYPT
      ? "Wrong password for the Tauri updater private key (set TAURI_SIGNING_PRIVATE_KEY_PASSWORD)."
      : "The Tauri updater private key is corrupt (checksum mismatch).";
  }
  return { keyId, seed: secret.subarray(0, 32), publicKey: secret.subarray(32, 64) };
};

/** A Tauri updater public key (`plugins.updater.pubkey`: base64 of a minisign public-key box). */
export const parseTauriPublicKey = (text: string): TauriPublicKey | undefined => {
  const bytes = boxPayload(text);
  return bytes?.length === 42 && ascii(bytes.subarray(0, 2)) === "Ed"
    ? { keyId: bytes.subarray(2, 10), publicKey: bytes.subarray(10, 42) }
    : undefined;
};

/** The `pubkey` an app must embed to accept this key's signatures. */
export const tauriPublicKeyText = (key: TauriPrivateKey): string => {
  const id = Buffer.from(key.keyId.toReversed()).toString("hex").toUpperCase();
  const payload = Buffer.concat([Buffer.from("Ed"), key.keyId, key.publicKey]).toString("base64");
  return Buffer.from(`${UNTRUSTED_PREFIX}minisign public key: ${id}\n${payload}\n`).toString(
    "base64",
  );
};

export const tauriKeysMatch = (key: TauriPrivateKey, publicKey: TauriPublicKey): boolean =>
  equalBytes(key.keyId, publicKey.keyId) && equalBytes(key.publicKey, publicKey.publicKey);

const prehash = (bytes: Uint8Array) => createHash("blake2b512").update(bytes).digest();

export interface TauriSignatureContext {
  /** Recorded in the trusted comment; Tauri writes the archive's file name. */
  readonly fileName: string;
  /** The version the feed announces for this archive. */
  readonly version: string;
  readonly timestamp: number;
}

/** The `signature` value for a Tauri feed entry: base64 of the minisign signature box. */
export const signTauriArchive = (
  key: TauriPrivateKey,
  bytes: Uint8Array,
  context: TauriSignatureContext,
): string => {
  const signature = ed25519.sign(prehash(bytes), key.seed);
  const trustedComment = `timestamp:${String(context.timestamp)}\tfile:${context.fileName}\tversion:${context.version}`;
  const globalSignature = ed25519.sign(
    Buffer.concat([signature, Buffer.from(trustedComment, "utf8")]),
    key.seed,
  );
  const box = [
    `${UNTRUSTED_PREFIX}${SIGNATURE_COMMENT}`,
    Buffer.concat([Buffer.from("ED"), key.keyId, signature]).toString("base64"),
    `${TRUSTED_PREFIX}${trustedComment}`,
    Buffer.from(globalSignature).toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(box, "utf8").toString("base64");
};

export interface TauriSignatureCheck {
  /** The key id, the prehashed signature and the global signature over the trusted comment all hold. */
  readonly valid: boolean;
  /** The `version:` the signer recorded, which the updater plugin compares with the feed's. */
  readonly signedVersion: string | undefined;
}

/** What the updater plugin checks before it installs an archive. */
export const verifyTauriSignature = (
  publicKey: TauriPublicKey,
  bytes: Uint8Array,
  signatureBase64: string,
): TauriSignatureCheck => {
  const [, signatureLine, trustedLine, globalLine] = Buffer.from(signatureBase64, "base64")
    .toString("utf8")
    .split("\n");
  const payload =
    signatureLine === undefined ? new Uint8Array() : Buffer.from(signatureLine, "base64");
  const trustedComment = trustedLine?.startsWith(TRUSTED_PREFIX)
    ? trustedLine.slice(TRUSTED_PREFIX.length)
    : undefined;
  if (
    payload.length !== 74 ||
    ascii(payload.subarray(0, 2)) !== "ED" ||
    !equalBytes(payload.subarray(2, 10), publicKey.keyId) ||
    trustedComment === undefined ||
    globalLine === undefined
  ) {
    return { valid: false, signedVersion: undefined };
  }
  const signature = payload.subarray(10);
  const valid =
    ed25519.verify(signature, prehash(bytes), publicKey.publicKey) &&
    ed25519.verify(
      Buffer.from(globalLine, "base64"),
      Buffer.concat([signature, Buffer.from(trustedComment, "utf8")]),
      publicKey.publicKey,
    );
  const signedVersion = trustedComment
    .split("\t")
    .find((field) => field.startsWith("version:"))
    ?.slice("version:".length);
  return { valid, signedVersion };
};
