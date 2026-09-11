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
import { compact, toOptional } from "@better-update/type-guards";
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
 * Apple returns the same "current certificate already exists / pending request"
 * wording whether the call came from a JWT ASC request or the Apple ID session,
 * so cert-limit detection lives here, in the shared connect layer.
 */
const CERT_LIMIT_PATTERN = /already have a current.*certificate|pending certificate request/iu;

export const isCertificateLimitMessage = (message: string): boolean =>
  CERT_LIMIT_PATTERN.test(message);

/**
 * The JWT signer for a vault `.p8` key. apple-utils signs ES256 tokens on demand
 * and refreshes them; a team key names its provider through `iss`, an
 * individual key (no issuer) signs with `sub: "user"` instead, which apple-utils
 * selects by the `issuerId` option being absent — hence `compact`, never
 * `issuerId: undefined`.
 */
export const buildAscToken = (credentials: AscCredentials): AppleUtils.Token =>
  new AppleUtils.Token({
    key: credentials.p8Pem,
    keyId: credentials.keyId,
    ...compact({ issuerId: toOptional(credentials.issuerId) }),
  });

/**
 * Build a headless ASC `RequestContext` from a vault `.p8` key. No `providerId`/
 * `teamId` is needed because the JWT itself selects the provider.
 */
export const buildTokenRequestContext = (
  credentials: AscCredentials,
): AppleUtils.RequestContext => ({
  token: buildAscToken(credentials),
});

/** Run an apple-utils promise, tagging any rejection as an {@link AppleConnectError}. */
export const wrapConnect = <T>(step: string, run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new AppleConnectError({ step, message: messageOf(cause) }),
  });
