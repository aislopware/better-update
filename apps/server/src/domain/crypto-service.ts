import { Context, Data } from "effect";

import type { Effect } from "effect";

export class CryptoError extends Data.TaggedError("CryptoError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export interface CryptoServiceImpl {
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
  readonly deriveKek: (
    secret: Uint8Array,
    orgId: string,
    keyVersion: number,
  ) => Effect.Effect<CryptoKey, CryptoError>;
  readonly importDekKey: (
    dek: Uint8Array,
    usages: readonly KeyUsage[],
  ) => Effect.Effect<CryptoKey, CryptoError>;
  readonly encryptAesGcm: (
    key: CryptoKey,
    plaintext: Uint8Array,
  ) => Effect.Effect<Uint8Array, CryptoError>;
  readonly decryptAesGcm: (
    key: CryptoKey,
    data: Uint8Array,
  ) => Effect.Effect<Uint8Array, CryptoError>;
}

export class CryptoService extends Context.Tag("server/CryptoService")<
  CryptoService,
  CryptoServiceImpl
>() {}
