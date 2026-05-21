import { toBase64 } from "@better-update/encoding";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce, randomBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

const aead = managedNonce(xchacha20poly1305);
const textEncoder = new TextEncoder();

const KEY_BYTES = 32;
const LENGTH_PREFIX_BYTES = 4;

/** A fresh 32-byte symmetric key — an org vault key or a per-credential DEK. */
export const randomKey = (): Uint8Array => randomBytes(KEY_BYTES);

/**
 * XChaCha20-Poly1305 with a managed 24-byte random nonce prepended to the
 * output (`nonce ‖ ciphertext ‖ tag`). `aad` is authenticated but not
 * encrypted. A fresh cipher is built per call — noble forbids reusing one.
 */
export const aeadEncrypt = (key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array =>
  aead(key, aad).encrypt(plaintext);

/**
 * Reverse of {@link aeadEncrypt}. Throws if the key, ciphertext, tag, or `aad`
 * differs from what sealed the blob — the only integrity signal we need.
 */
export const aeadDecrypt = (key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array =>
  aead(key, aad).decrypt(sealed);

/**
 * Deterministic, unambiguous AAD framing: a domain tag plus each part, every
 * segment length-prefixed (4-byte big-endian), so no two distinct part lists
 * ever encode to the same bytes (prevents cross-binding confusion).
 */
export const encodeAad = (domain: string, parts: readonly (string | number)[]): Uint8Array => {
  const segments = [domain, ...parts.map(String)].map((text) => textEncoder.encode(text));
  const size = segments.reduce((total, seg) => total + LENGTH_PREFIX_BYTES + seg.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  segments.reduce((offset, seg) => {
    view.setUint32(offset, seg.length);
    out.set(seg, offset + LENGTH_PREFIX_BYTES);
    return offset + LENGTH_PREFIX_BYTES + seg.length;
  }, 0);
  return out;
};

/** SSH-style fingerprint of an age recipient string: `SHA256:<base64, no padding>`. */
export const fingerprint = (recipient: string): string =>
  `SHA256:${toBase64(sha256(textEncoder.encode(recipient))).replace(/=+$/u, "")}`;
