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
}

export class CryptoService extends Context.Tag("server/CryptoService")<
  CryptoService,
  CryptoServiceImpl
>() {}
