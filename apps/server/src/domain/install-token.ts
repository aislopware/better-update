import { Effect } from "effect";

import { CryptoService } from "./crypto-service";

import type { CryptoError } from "./crypto-service";

const EXPIRY_MS = 3_600_000;

export const generateInstallToken = (
  buildId: string,
  secret: string,
): Effect.Effect<
  { readonly token: string; readonly expires: number },
  CryptoError,
  CryptoService
> =>
  Effect.gen(function* () {
    const expires = Math.floor((Date.now() + EXPIRY_MS) / 1000);
    const payload = `${buildId}:${expires}`;
    const service = yield* CryptoService;
    const token = yield* service.hmacSignBase64Url(secret, payload);
    return { token, expires };
  });

export const verifyInstallToken = (
  buildId: string,
  token: string,
  expires: number,
  secret: string,
): Effect.Effect<boolean, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    if (Math.floor(Date.now() / 1000) > expires) {
      return false;
    }
    const payload = `${buildId}:${expires}`;
    const service = yield* CryptoService;
    return yield* service.hmacVerifyBase64Url(secret, payload, token);
  });
