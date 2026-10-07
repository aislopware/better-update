import { Context, Data } from "effect";

import type { Effect } from "effect";

export class CryptoError extends Data.TaggedError("CryptoError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/** An Ed25519 key: its 32-byte public key and a signer. */
export interface Ed25519Key {
  readonly publicKey: Uint8Array;
  readonly sign: (message: Uint8Array) => Effect.Effect<Uint8Array, CryptoError>;
}

export interface CryptoServiceImpl {
  readonly digest: (
    algorithm: "SHA-1" | "SHA-256" | "SHA-512",
    data: Uint8Array,
  ) => Effect.Effect<Uint8Array, CryptoError>;
  /**
   * The Ed25519 key whose seed is HKDF-SHA-256 of `secret` with `salt` and
   * `info`: the same inputs always give the same key, so nothing is stored.
   */
  readonly deriveEd25519Key: (params: {
    readonly secret: string;
    readonly salt: string;
    readonly info: string;
  }) => Effect.Effect<Ed25519Key, CryptoError>;
  readonly sha256Hex: (input: string) => Effect.Effect<string, CryptoError>;
  /**
   * SHA-256 of the UTF-8 bytes of `input`, encoded unpadded base64url. Matches
   * the better-auth api-key plugin's `defaultKeyHasher`
   * (`base64Url.encode(SHA-256(key), { padding: false })`), so a row hashed with
   * this verifies via the plugin's `verifyApiKey`.
   */
  readonly sha256Base64Url: (input: string) => Effect.Effect<string, CryptoError>;
  readonly sha256Fraction: (salt: string, clientId: string) => Effect.Effect<number, CryptoError>;
  readonly hmacSignBase64Url: (
    secret: string,
    payload: string,
  ) => Effect.Effect<string, CryptoError>;
  readonly hmacVerifyBase64Url: (
    secret: string,
    payload: string,
    token: string,
  ) => Effect.Effect<boolean, CryptoError>;
  /**
   * Verify an RSASSA-PKCS1-v1_5 + SHA-256 signature (Expo code-signing
   * `rsa-v1_5-sha256`) over the UTF-8 bytes of `payload` against the public key
   * of the leaf certificate PEM. Returns false on a clean mismatch; raises
   * CryptoError when the certificate or signature is malformed.
   */
  readonly rsaPkcs1Sha256Verify: (params: {
    readonly certificatePem: string;
    readonly payload: string;
    readonly signatureBase64: string;
  }) => Effect.Effect<boolean, CryptoError>;
}

export class CryptoService extends Context.Service<CryptoService, CryptoServiceImpl>()(
  "server/CryptoService",
) {}
