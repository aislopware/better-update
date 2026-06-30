/**
 * Shared bridge to the `@expo/apple-utils` App Store Connect entity layer for
 * the **headless** (JWT) path. apple-utils routes by `RequestContext`: a context
 * carrying a signed `Token` hits the public ASC REST API
 * (`api.appstoreconnect.apple.com/v1`) with no cookie session — the same surface
 * the CLI's vault `.p8` keys authenticate against. Interactive flows pass a
 * cookie context from `AppleAuth.buildRequestContext` instead; both drive the
 * same entity managers.
 */
// @expo/apple-utils is ncc-bundled CJS; the entity managers + `Token` are read
// off the default import (see credentials-generator-apple-id.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Data, Effect } from "effect";

import type { AscCredentials } from "./asc-credentials";

export class AppleConnectError extends Data.TaggedError("AppleConnectError")<{
  readonly step: string;
  readonly message: string;
}> {}

export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Build a headless ASC `RequestContext` from a vault `.p8` key. The `Token`
 * signs ES256 JWTs on demand (apple-utils refreshes them); no `providerId`/
 * `teamId` is needed because the JWT's issuer selects the provider.
 */
export const buildTokenRequestContext = (
  credentials: AscCredentials,
): AppleUtils.RequestContext => ({
  token: new AppleUtils.Token({
    key: credentials.p8Pem,
    keyId: credentials.keyId,
    issuerId: credentials.issuerId,
  }),
});

/** Run an apple-utils promise, tagging any rejection as an {@link AppleConnectError}. */
export const wrapConnect = <T>(step: string, run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new AppleConnectError({ step, message: messageOf(cause) }),
  });
