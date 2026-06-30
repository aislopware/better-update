import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
// @expo/apple-utils is ncc-bundled CJS; the `ApiKey` entity manager + the
// `ApiKeyType`/`UserRole` enums are read off the default import (see
// credentials-generator-apple-id.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Effect, Schedule } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { AppleIdGenerateFailedError, messageOf, wrap } from "./credentials-generator-apple";

import type { ApiClient } from "../services/api-client";

// ── ASC API key (.p8) auto-creation via Apple ID ──────────────────
// App Store Connect API keys are created on the iris/v1 endpoint that the Apple ID
// cookie session authenticates (NOT the public ASC REST API) — the same session
// used for certs/profiles/APNs keys. apple-utils' `ApiKey` ConnectModel wraps it,
// so the CLI can mint a key for the user instead of making them download a `.p8`
// from App Store Connect by hand. Mirrors `eas submit`'s auto-generate-ASC-key flow.

/** The two roles `eas-cli` offers for a generated key; ADMIN is the default. */
export type AscApiKeyRole = "ADMIN" | "APP_MANAGER";

const toUserRole = (role: AscApiKeyRole): AppleUtils.UserRole =>
  role === "APP_MANAGER" ? AppleUtils.UserRole.APP_MANAGER : AppleUtils.UserRole.ADMIN;

// App Store Connect caps an API key's name at 30 characters; a longer value is
// rejected at creation with "An attribute value is too long". Keep the default
// comfortably under that (base-36 epoch ≈ 8 chars) and clamp any caller-supplied
// nickname so a long `--nickname` (or an old ISO-timestamp default) can't fail.
const ASC_API_KEY_NICKNAME_MAX_LENGTH = 30;

const clampAscApiKeyNickname = (nickname: string): string =>
  nickname.slice(0, ASC_API_KEY_NICKNAME_MAX_LENGTH);

/** Default nickname shown in App Store Connect → Users and Access → Integrations. */
export const defaultAscApiKeyNickname = (): string => `[better-update] ${Date.now().toString(36)}`;

// A freshly-created key is not immediately queryable — Apple needs a moment to
// propagate it, during which the download (an info GET under the hood) fails with
// "There is no resource of type 'apiKeys'…". eas-cli retries that with exponential
// backoff; mirror it. Any OTHER download failure (auth, already-downloaded) is
// terminal and surfaces immediately rather than burning the retry budget.
const ASC_KEY_NOT_READY_PATTERN = /no resource of type|resource does not exist/iu;

// 6 retries, base 1s, factor 2 — matches eas-cli's downloadWithRetryAsync defaults.
const ASC_KEY_DOWNLOAD_RETRY = Schedule.exponential("1 second", 2).pipe(
  Schedule.intersect(Schedule.recurs(6)),
);

const downloadAscKeyWithRetry = (key: AppleUtils.ApiKey) =>
  Effect.tryPromise({
    try: async () => key.downloadAsync(),
    catch: (cause) =>
      new AppleIdGenerateFailedError({ step: "apple-download-asc-key", message: messageOf(cause) }),
  }).pipe(
    Effect.flatMap((pem) =>
      pem === null || pem.length === 0
        ? Effect.fail(
            new AppleIdGenerateFailedError({
              step: "apple-download-asc-key",
              message:
                "App Store Connect returned no private key for the new API key — it may already have been downloaded. A key can only be downloaded once; create a new one or upload the .p8 manually with `credentials upload-asc-key`.",
            }),
          )
        : Effect.succeed(pem),
    ),
    // Retry ONLY the propagation-delay error; the no-private-key failure above and
    // any auth/contract error fall through unchanged.
    Effect.retry({
      while: (error: AppleIdGenerateFailedError) => ASC_KEY_NOT_READY_PATTERN.test(error.message),
      schedule: ASC_KEY_DOWNLOAD_RETRY,
    }),
    // Retries exhausted while still propagating: replace Apple's cryptic wording
    // with actionable guidance (the key WAS created, only the download lagged).
    Effect.catchIf(
      (error) => ASC_KEY_NOT_READY_PATTERN.test(error.message),
      () =>
        Effect.fail(
          new AppleIdGenerateFailedError({
            step: "apple-download-asc-key",
            message:
              "App Store Connect is still provisioning the new API key (this can take up to a minute). The key was created — re-run shortly, or download the .p8 from App Store Connect → Users and Access → Integrations and import it with `credentials upload-asc-key`.",
          }),
        ),
    ),
  );

// Best-effort rescue: persist the one-shot `.p8` next to the user so a created-but-
// unstored key is recoverable. Apple only lets a key be downloaded once, so once the
// in-memory copy is gone the key is dead weight occupying a team slot. Mirrors the
// APNs generator's orphan guard.
const writeRescueP8 = (keyId: string, p8Pem: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = `AuthKey_${keyId}.p8`;
    yield* fs.writeFileString(filePath, p8Pem, { mode: 0o600 });
    return filePath;
  });

export interface GenerateAscApiKeyViaAppleIdInput {
  readonly context: AppleUtils.RequestContext;
  /** 10-char Apple Developer Team ID, stored as the key's team identifier. */
  readonly appleTeamIdentifier: string;
  /** Nickname shown in App Store Connect. */
  readonly nickname: string;
  readonly role: AscApiKeyRole;
  /** Display name for the stored credential row; defaults to the App Store Connect nickname. */
  readonly name?: string;
}

export interface GeneratedAscApiKey {
  readonly id: string;
  readonly keyId: string;
  readonly issuerId: string;
  readonly name: string;
  readonly role: AscApiKeyRole;
}

/**
 * Create an App Store Connect API key from the Apple ID cookie session, download
 * its one-shot `.p8`, resolve the issuer id, and store the sealed envelope in the
 * vault — the zero-knowledge equivalent of downloading a key from App Store Connect
 * and running `credentials upload-asc-key`, but without the manual round-trip.
 */
export const generateAndUploadAscApiKeyViaAppleId = (
  api: ApiClient,
  input: GenerateAscApiKeyViaAppleIdInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;

    const key = yield* wrap("apple-create-asc-key", async () =>
      AppleUtils.ApiKey.createAsync(ctx, {
        nickname: clampAscApiKeyNickname(input.nickname),
        allAppsVisible: true,
        roles: [toUserRole(input.role)],
        keyType: AppleUtils.ApiKeyType.PUBLIC_API,
      }),
    );

    // One-shot download — Apple burns `canDownload` after the first successful fetch.
    const p8Pem = yield* downloadAscKeyWithRetry(key);
    // Default the stored row's name to the App Store Connect nickname
    // (e.g. "[better-update] mc8x…") rather than the opaque key id, so the
    // dashboard Identifier column reads like the key's name in App Store Connect.
    const displayName = input.name ?? clampAscApiKeyNickname(input.nickname);

    // Everything past the one-shot download (issuer lookup, vault unlock, seal,
    // upload) failing leaves an orphaned key on Apple that can never be re-downloaded.
    // Rescue the `.p8` to disk and tell the user how to re-import it.
    const persist = Effect.gen(function* () {
      // Re-fetch with DEFAULT_INCLUDES (which carries `provider`) — the create
      // response does not reliably include the relationship the issuer id lives on.
      const full = yield* wrap("apple-fetch-asc-key", async () =>
        AppleUtils.ApiKey.infoAsync(ctx, { id: key.id }),
      );
      const issuerId = full.attributes.provider?.id;
      if (issuerId === undefined || issuerId.length === 0) {
        return yield* new AppleIdGenerateFailedError({
          step: "resolve-issuer-id",
          message:
            "App Store Connect did not return an issuer ID for the new key. Find it under Users and Access → Integrations and import the .p8 with `credentials upload-asc-key`.",
        });
      }
      const metadata = compact({
        name: displayName,
        keyId: key.id,
        issuerId,
        appleTeamIdentifier: input.appleTeamIdentifier,
      });
      const session = yield* openVaultSessionInteractive(api);
      const envelope = yield* sealForUpload({
        session,
        credentialType: "asc-api-key",
        metadata,
        secret: { p8Pem },
      });
      const created = yield* api.ascApiKeys.upload({
        // Persist the role we created the key with so the dashboard's Roles column
        // reflects it (matches Apple's UserRole string: ADMIN / APP_MANAGER).
        payload: { ...toUploadEnvelope(envelope), ...metadata, roles: [input.role] },
      });
      return { id: created.id, issuerId };
    });

    const stored = yield* persist.pipe(
      Effect.catchAll((cause) =>
        Effect.gen(function* () {
          const rescuePath = yield* writeRescueP8(key.id, p8Pem).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );
          const where =
            rescuePath === null
              ? "could not be saved locally and is now unrecoverable"
              : `was saved to ${rescuePath} — re-import with \`credentials upload-asc-key --p8 ${rescuePath} --key-id ${key.id}\` (find the issuer ID under App Store Connect → Users and Access → Integrations)`;
          return yield* new AppleIdGenerateFailedError({
            step: "store-asc-key",
            message: `Created App Store Connect API key ${key.id} on Apple but failed to store it (${messageOf(cause)}). The downloaded .p8 ${where}.`,
          });
        }),
      ),
    );

    return {
      id: stored.id,
      keyId: key.id,
      issuerId: stored.issuerId,
      name: displayName,
      role: input.role,
    } satisfies GeneratedAscApiKey;
  });

export interface AppleIdAscApiKeySummary {
  /** App Store Connect key id (the `.p8` key id). */
  readonly keyId: string;
  readonly nickname: string;
}

/**
 * List the team's active App Store Connect API keys as seen on Apple (via the
 * cookie session). Used before auto-creating a key to avoid making a redundant
 * one — note a key's `.p8` is downloadable only once, so a key listed here is
 * usable for publishing only if its `.p8` was captured at creation (i.e. it is
 * already in the vault). Surfacing them lets the caller warn + respect Apple's
 * per-team key cap rather than blindly creating another.
 */
export const listAscApiKeysViaAppleId = (ctx: AppleUtils.RequestContext) =>
  Effect.gen(function* () {
    const keys = yield* wrap("apple-list-asc-keys", async () => AppleUtils.ApiKey.getAsync(ctx));
    return keys
      .filter((key) => key.attributes.isActive)
      .map(
        (key) =>
          ({
            keyId: key.id,
            nickname: key.attributes.nickname,
          }) satisfies AppleIdAscApiKeySummary,
      );
  });
