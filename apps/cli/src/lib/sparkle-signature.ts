/**
 * Sparkle 2 EdDSA update signatures (`sparkle:edSignature`): Ed25519 over the
 * whole archive, with the key `generate_keys -x` exports — base64 of either
 *
 * - 32 bytes: the seed (keys generated since Sparkle 2), or
 * - 96 bytes: the older format, an expanded secret (clamped scalar ‖ nonce
 *   prefix, as the orlp ed25519 library stores it) followed by the public key.
 *
 * The older format has no seed to hand a standard signer, so it is signed
 * from the scalar directly — the same RFC 8032 computation, giving the same
 * signature `sign_update` would.
 */
import { createHash } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToNumberLE, numberToBytesLE } from "@noble/curves/utils.js";

export type SparklePrivateKey =
  | { readonly kind: "seed"; readonly seed: Uint8Array; readonly publicKey: Uint8Array }
  | {
      readonly kind: "expanded";
      readonly scalar: bigint;
      readonly prefix: Uint8Array;
      readonly publicKey: Uint8Array;
    };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

/** Decode an exported Sparkle private key, or a message saying why it is not one. */
export const parseSparklePrivateKey = (text: string): SparklePrivateKey | string => {
  const trimmed = text.trim();
  if (!BASE64.test(trimmed)) {
    return "The Sparkle private key is not base64 (export it with `generate_keys -x <file>`).";
  }
  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.byteLength === 32) {
    return { kind: "seed", seed: bytes, publicKey: ed25519.getPublicKey(bytes) };
  }
  if (bytes.byteLength === 96) {
    return {
      kind: "expanded",
      scalar: bytesToNumberLE(bytes.subarray(0, 32)),
      prefix: bytes.subarray(32, 64),
      publicKey: bytes.subarray(64, 96),
    };
  }
  return `The Sparkle private key decodes to ${String(bytes.byteLength)} bytes; generate_keys exports 32 (seed) or 96 (older format).`;
};

/** The `SUPublicEDKey` value the key's signatures verify against. */
export const sparklePublicKeyBase64 = (key: SparklePrivateKey): string =>
  Buffer.from(key.publicKey).toString("base64");

const sha512Scalar = (...parts: readonly Uint8Array[]): bigint =>
  ed25519.Point.Fn.create(
    bytesToNumberLE(parts.reduce((hash, part) => hash.update(part), createHash("sha512")).digest()),
  );

const signExpanded = (
  key: Extract<SparklePrivateKey, { readonly kind: "expanded" }>,
  message: Uint8Array,
): Uint8Array => {
  const { Fn } = ed25519.Point;
  const nonce = sha512Scalar(key.prefix, message);
  const commitment = ed25519.Point.BASE.multiply(nonce).toBytes();
  const challenge = sha512Scalar(commitment, key.publicKey, message);
  const response = Fn.add(nonce, Fn.mul(challenge, Fn.create(key.scalar)));
  return Buffer.concat([commitment, numberToBytesLE(response, 32)]);
};

/** Base64 `sparkle:edSignature` of an archive's bytes. */
export const signSparkleArchive = (key: SparklePrivateKey, archive: Uint8Array): string =>
  Buffer.from(
    key.kind === "seed" ? ed25519.sign(archive, key.seed) : signExpanded(key, archive),
  ).toString("base64");

/** Whether a signature verifies against `SUPublicEDKey` — Sparkle's own check. */
export const verifySparkleSignature = (
  publicKeyBase64: string,
  signatureBase64: string,
  archive: Uint8Array,
): boolean => {
  try {
    return ed25519.verify(
      Buffer.from(signatureBase64, "base64"),
      archive,
      Buffer.from(publicKeyBase64, "base64"),
      { zip215: false },
    );
  } catch {
    return false;
  }
};
