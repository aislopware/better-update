import { compact, toOptional } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
// @expo/apple-utils is ncc-bundled CJS; `import * as` only surfaces `default`/`module.exports`
// via Node ESM's cjs-module-lexer, so the entity managers + enums (Keys, ...) are read off
// the default import.
import AppleUtils from "@expo/apple-utils";
import { Data, Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { AppleIdGenerateFailedError, messageOf, wrap } from "./credentials-generator-apple";

import type { ApiClient } from "../services/api-client";

// ── APNs push keys (.p8) via Apple ID ─────────────────────────────
// Apple does not expose APNs key creation on the public ASC REST API — only the
// Developer Portal session (the same Apple ID cookie session used for
// certs/profiles in credentials-generator-apple-id). apple-utils' `Keys`
// manager wraps those portal endpoints.

// Apple Push Notification service config id (Keys.AppStoreKeyServiceConfigID.APNS).
// Hardcoded so the APNs filter does not depend on the enum surviving the CJS bundle.
const APNS_SERVICE_ID = "U27F4V844T";

// At the per-team cap, Apple's portal returns a plain server error ("…maximum
// allowed number of team scoped Keys…") — apple-utils does NOT wrap it as a typed
// MaxKeysCreatedError in this path (verified live), so match the wording too,
// mirroring CERT_LIMIT_PATTERN. Without this the revoke-and-retry never triggers.
const APNS_KEY_LIMIT_PATTERN = /maximum allowed number of .*keys/iu;

// Apple caps a team at two APNs auth keys. apple-utils throws MaxKeysCreatedError
// when the create would exceed that; we surface it as a dedicated tag so the
// command layer can offer an interactive revoke-and-retry (mirrors CertificateLimitError).
export class ApnsKeyLimitError extends Data.TaggedError("ApnsKeyLimitError")<{
  readonly message: string;
}> {}

const wrapKeyCreate = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const message = messageOf(cause);
      return cause instanceof AppleUtils.Keys.MaxKeysCreatedError ||
        APNS_KEY_LIMIT_PATTERN.test(message)
        ? new ApnsKeyLimitError({ message })
        : new AppleIdGenerateFailedError({ step: "apple-create-key", message });
    },
  });

// Best-effort rescue: persist the one-shot .p8 next to the user so a created-but-
// unstored key is recoverable. Apple only lets a key be downloaded once, so once
// the in-memory copy is gone the key is dead weight occupying a team slot.
const writeRescueP8 = (keyId: string, p8Pem: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = `AuthKey_${keyId}.p8`;
    yield* fs.writeFileString(filePath, p8Pem, { mode: 0o600 });
    return filePath;
  });

export interface GenerateApnsKeyViaAppleIdInput {
  readonly context: AppleUtils.RequestContext;
  readonly appleTeamIdentifier: string;
  readonly appleTeamName: string | null;
  readonly name: string;
}

export const generateAndUploadApnsKeyViaAppleId = (
  api: ApiClient,
  input: GenerateApnsKeyViaAppleIdInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;

    const key = yield* wrapKeyCreate(async () =>
      AppleUtils.Keys.createKeyAsync(ctx, { name: input.name, isApns: true }),
    );

    // Download immediately — Apple burns `canDownload` after the first fetch.
    const p8Pem = yield* wrap("apple-download-key", async () =>
      AppleUtils.Keys.downloadKeyAsync(ctx, { id: key.id }),
    );

    const metadata = { keyId: key.id, appleTeamIdentifier: input.appleTeamIdentifier };

    const persist = Effect.gen(function* () {
      const session = yield* openVaultSessionInteractive(api);
      const envelope = yield* sealForUpload({
        session,
        credentialType: "push-key",
        metadata,
        secret: { p8Pem },
      });
      return yield* api.applePushKeys.upload({
        payload: {
          ...toUploadEnvelope(envelope),
          ...metadata,
          ...compact({ appleTeamName: toOptional(input.appleTeamName) }),
        },
      });
    });

    // Anything after the one-shot download (vault unlock, seal, upload) failing
    // leaves an orphaned key on Apple that can never be re-downloaded. Rescue the
    // .p8 to disk and tell the user how to re-import it instead of losing it.
    const created = yield* persist.pipe(
      Effect.catchAll((cause) =>
        Effect.gen(function* () {
          const rescuePath = yield* writeRescueP8(key.id, p8Pem).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );
          const where =
            rescuePath === null
              ? "could not be saved locally and is now unrecoverable"
              : `was saved to ${rescuePath} — re-import with \`credentials generate push-key --p8 ${rescuePath} --key-id ${key.id} --apple-team-id ${input.appleTeamIdentifier}\``;
          return yield* new AppleIdGenerateFailedError({
            step: "store-apns-key",
            message: `Created APNs key ${key.id} on Apple but failed to store it (${messageOf(cause)}). The downloaded .p8 ${where}.`,
          });
        }),
      ),
    );

    return {
      id: created.id,
      keyId: key.id,
      appleTeamIdentifier: input.appleTeamIdentifier,
      name: key.name,
    };
  });

export interface AppleIdApnsKeySummary {
  readonly developerPortalKeyId: string;
  readonly name: string;
  readonly canRevoke: boolean;
}

// List the team's APNs auth keys (filtered out of all portal keys — DeviceCheck,
// MusicKit, SIWA also live here). Used by the create-limit recovery + revoke picker.
export const listApnsKeysViaAppleId = (ctx: AppleUtils.RequestContext) =>
  Effect.gen(function* () {
    const keys = yield* wrap("apple-list-keys", async () => AppleUtils.Keys.getKeysAsync(ctx));
    // `services` is only populated by getKeyInfoAsync, so fetch detail per key.
    const detailed = yield* Effect.forEach(
      keys,
      (key) =>
        wrap("apple-get-key-info", async () =>
          AppleUtils.Keys.getKeyInfoAsync(ctx, { id: key.id }),
        ),
      { concurrency: 4 },
    );
    return detailed
      .filter((info) => info.services.some((service) => service.id === APNS_SERVICE_ID))
      .map(
        (info) =>
          ({
            developerPortalKeyId: info.id,
            name: info.name,
            canRevoke: info.canRevoke,
          }) satisfies AppleIdApnsKeySummary,
      );
  });

export const revokeApnsKeyViaAppleId = (
  ctx: AppleUtils.RequestContext,
  developerPortalKeyId: string,
) =>
  wrap("apple-revoke-key", async () =>
    AppleUtils.Keys.revokeKeyAsync(ctx, { id: developerPortalKeyId }),
  );

export interface RevokeLocalApnsKeyInput {
  readonly context: AppleUtils.RequestContext;
  /** Local server-row id of the stored push key. */
  readonly pushKeyId: string;
  /** Apple Developer Portal key id (the `.p8` key id) to revoke upstream. */
  readonly keyId: string;
  /** Revoke on Apple but keep the stored credential. */
  readonly keepLocal: boolean;
}

/**
 * Revoke an APNs key on Apple and (optionally) delete the stored copy. Only keys
 * still present on the portal are revoked — one already gone upstream is treated
 * as `revokedOnApple: false` and still deleted locally, so cleanup never wedges.
 * Shared by the `revoke push-key` command and the interactive wizard.
 */
export const revokeLocalApnsKey = (api: ApiClient, input: RevokeLocalApnsKeyInput) =>
  Effect.gen(function* () {
    const remoteKeys = yield* listApnsKeysViaAppleId(input.context);
    const present = remoteKeys.some((entry) => entry.developerPortalKeyId === input.keyId);
    if (present) {
      yield* revokeApnsKeyViaAppleId(input.context, input.keyId);
    }
    if (!input.keepLocal) {
      yield* api.applePushKeys.delete({ path: { id: input.pushKeyId } });
    }
    return {
      localId: input.pushKeyId,
      keyId: input.keyId,
      revokedOnApple: present,
      deletedLocally: !input.keepLocal,
    };
  });
