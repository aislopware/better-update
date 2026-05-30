import { Context, Data } from "effect";

import type { Effect } from "effect";

export class CryptoError extends Data.TaggedError("CryptoError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export interface CryptoServiceImpl {
  readonly sha256Hex: (input: string) => Effect.Effect<string, CryptoError>;
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

export class CryptoService extends Context.Tag("server/CryptoService")<
  CryptoService,
  CryptoServiceImpl
>() {}
