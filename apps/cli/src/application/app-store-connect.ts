/**
 * Shared App Store Connect "session" resolver for the headless (Token / CI-safe)
 * `app-store` and `testflight` command groups. Every leaf needs the same three
 * things: a signed-JWT `RequestContext` (built from a vault `.p8`), the target
 * App id, and — for precise errors — the bundle id. This folds the eas.json
 * submit profile, optional command flags, and the public ASC API into one
 * resolver so the leaves stay thin shells.
 *
 * Auth is the same vault ASC API key the CLI already uses for `altool` uploads:
 * decrypted locally, signed into ES256 JWTs by apple-utils. There is no cookie
 * session, so these commands run unattended in CI.
 */
import { compact } from "@better-update/type-guards";
// @expo/apple-utils is ncc-bundled CJS; the entity managers + `Platform` enum are
// read off the default import (see apple-asc-connect.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { ascKeyRequestContext } from "../lib/credentials-generator-apple";
import { readSubmitProfile } from "../lib/eas-json";
import { AppStoreError, InvalidArgumentError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { EasIosSubmitProfile } from "../lib/eas-config";
import type { ApiClient } from "../services/api-client";

/**
 * Per-command extra `tag → exit code` map for every `app-store`/`testflight`
 * leaf. Merged onto the base map at the `runEffect` boundary.
 */
export const APP_STORE_EXIT_EXTRAS = {
  AppStoreError: 1,
  AppleConnectError: 6,
  InvalidArgumentError: 2,
  IdentityError: 2,
  CredentialValidationError: 2,
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

/**
 * Citty args shared by every ASC leaf: which submit profile to read config from,
 * plus per-run overrides for the API key, app id, and bundle id. Spread into a
 * leaf's `args` alongside its command-specific flags.
 */
export const ASC_COMMON_ARGS = {
  profile: {
    type: "string",
    default: "production",
    description:
      "eas.json submit profile to read App Store Connect config from (default: production)",
  },
  "asc-api-key-id": {
    type: "string",
    description:
      "Stored ASC API key id to authenticate with (overrides the submit profile's ascApiKeyId)",
  },
  "app-id": {
    type: "string",
    description: "App Store Connect app id (overrides the profile's ascAppId / bundle-id lookup)",
  },
  "bundle-identifier": {
    type: "string",
    description: "Bundle id used to resolve the app when no app id is configured",
  },
} as const;

/** The parsed shape of {@link ASC_COMMON_ARGS} a leaf passes to {@link openAscSession}. */
export interface AscCommonArgs {
  readonly profile: string;
  readonly "asc-api-key-id"?: string | undefined;
  readonly "app-id"?: string | undefined;
  readonly "bundle-identifier"?: string | undefined;
}

/** A resolved headless App Store Connect session, ready to drive entity managers. */
export interface AscSession {
  readonly ctx: AppleUtils.RequestContext;
  readonly appId: string;
  readonly ascApiKeyId: string;
  readonly bundleIdentifier: string | undefined;
}

const PLATFORMS: Record<string, AppleUtils.Platform> = {
  IOS: AppleUtils.Platform.IOS,
  MAC_OS: AppleUtils.Platform.MAC_OS,
  TV_OS: AppleUtils.Platform.TV_OS,
  VISION_OS: AppleUtils.Platform.VISION_OS,
};

/** Short `--platform` aliases the CLI accepts, mapped to the canonical enum name. */
const PLATFORM_ALIASES: Record<string, string> = {
  MAC: "MAC_OS",
  TV: "TV_OS",
  VISION: "VISION_OS",
};

/**
 * Normalize a `--platform` flag to an apple-utils {@link AppleUtils.Platform},
 * defaulting to iOS. Accepts the short aliases the CLI surfaces (`ios`, `mac`,
 * `tv`, `vision`) as well as the canonical enum names.
 */
export const normalizePlatform = (
  raw: string | undefined,
): Effect.Effect<AppleUtils.Platform, InvalidArgumentError> => {
  if (raw === undefined) {
    return Effect.succeed(AppleUtils.Platform.IOS);
  }
  const upper = raw.trim().toUpperCase();
  const platform = PLATFORMS[PLATFORM_ALIASES[upper] ?? upper];
  if (platform === undefined) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `Unknown platform "${raw}". Use one of: ios, mac, tv, vision.`,
      }),
    );
  }
  return Effect.succeed(platform);
};

const RELEASE_TYPES: Record<string, AppleUtils.ReleaseType> = {
  AFTER_APPROVAL: AppleUtils.ReleaseType.AFTER_APPROVAL,
  MANUAL: AppleUtils.ReleaseType.MANUAL,
  SCHEDULED: AppleUtils.ReleaseType.SCHEDULED,
};

/**
 * Normalize a `--release-type` flag to an apple-utils {@link AppleUtils.ReleaseType},
 * or `undefined` when the flag was omitted (leave the version's setting untouched).
 */
export const normalizeReleaseType = (
  raw: string | undefined,
): Effect.Effect<AppleUtils.ReleaseType | undefined, InvalidArgumentError> => {
  if (raw === undefined) {
    return Effect.succeed(undefined);
  }
  const releaseType = RELEASE_TYPES[raw.trim().toUpperCase()];
  if (releaseType === undefined) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `Unknown --release-type "${raw}". Use AFTER_APPROVAL, MANUAL, or SCHEDULED.`,
      }),
    );
  }
  return Effect.succeed(releaseType);
};

interface ResolveAscSessionInput {
  readonly api: ApiClient;
  /** Project root holding `eas.json`, for reading the submit profile. */
  readonly projectRoot: string;
  readonly profileName: string;
  readonly ascApiKeyId?: string;
  readonly appId?: string;
  readonly bundleIdentifier?: string;
}

/** Resolve the ASC API key id to authenticate with: flag > profile > the lone stored key. */
const resolveAscApiKeyId = (params: {
  readonly api: ApiClient;
  readonly flagKeyId: string | undefined;
  readonly profileKeyId: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.flagKeyId !== undefined) {
      return params.flagKeyId;
    }
    if (params.profileKeyId !== undefined) {
      return params.profileKeyId;
    }
    const stored = yield* params.api.ascApiKeys.list();
    const [only] = stored.items;
    if (stored.items.length === 1 && only !== undefined) {
      yield* printHuman(`Using your stored ASC API key "${only.name}" (${only.keyId}).`);
      return only.id;
    }
    if (stored.items.length === 0) {
      return yield* new AppStoreError({
        message:
          "No App Store Connect API key found. Create one with `better-update credentials generate asc-key`, or pass --asc-api-key-id.",
      });
    }
    const names = stored.items.map((key) => `${key.name} (${key.id})`).join(", ");
    return yield* new AppStoreError({
      message: `Multiple ASC API keys are stored: ${names}. Pass --asc-api-key-id <id>, or set ascApiKeyId on the eas.json submit profile.`,
    });
  });

/** Resolve the target App id: flag > profile ascAppId > `App.findAsync` by bundle id. */
const resolveAppId = (params: {
  readonly ctx: AppleUtils.RequestContext;
  readonly flagAppId: string | undefined;
  readonly profileAppId: string | undefined;
  readonly bundleId: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.flagAppId !== undefined) {
      return params.flagAppId;
    }
    if (params.profileAppId !== undefined) {
      return params.profileAppId;
    }
    const { bundleId } = params;
    if (bundleId === undefined) {
      return yield* new AppStoreError({
        message:
          "Cannot resolve the App Store Connect app. Pass --app-id, or set ascAppId / bundleIdentifier on the eas.json submit profile.",
      });
    }
    const app = yield* wrapConnect("apple-find-app", async () =>
      AppleUtils.App.findAsync(params.ctx, { bundleId }),
    );
    if (app === null) {
      return yield* new AppStoreError({
        message: `No App Store Connect app found for bundle id ${bundleId}. Pass --app-id.`,
      });
    }
    return app.id;
  });

/**
 * Resolve a full {@link AscSession} from the submit profile + flag overrides. A
 * missing/invalid submit profile is tolerated when flags supply everything (an
 * unlinked project can still target an app by `--app-id` + `--asc-api-key-id`).
 */
export const resolveAscSession = (input: ResolveAscSessionInput) =>
  Effect.gen(function* () {
    const profile: EasIosSubmitProfile | undefined = yield* readSubmitProfile(
      input.projectRoot,
      input.profileName,
    ).pipe(
      Effect.map((resolved) => resolved.ios),
      Effect.orElseSucceed(() => undefined),
    );
    const ascApiKeyId = yield* resolveAscApiKeyId({
      api: input.api,
      flagKeyId: input.ascApiKeyId,
      profileKeyId: profile?.ascApiKeyId,
    });
    const ctx = yield* ascKeyRequestContext(input.api, ascApiKeyId);
    const bundleId = input.bundleIdentifier ?? profile?.bundleIdentifier;
    const appId = yield* resolveAppId({
      ctx,
      flagAppId: input.appId,
      profileAppId: profile?.ascAppId,
      bundleId,
    });
    return { ctx, appId, ascApiKeyId, bundleIdentifier: bundleId } satisfies AscSession;
  });

/**
 * Resolve an {@link AscSession} straight from a leaf's parsed common args,
 * pulling the api client + project root from the CLI services. The single entry
 * point every `app-store`/`testflight` leaf calls.
 */
export const openAscSession = (args: AscCommonArgs) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    return yield* resolveAscSession({
      api,
      projectRoot,
      profileName: args.profile,
      ...compact({
        ascApiKeyId: args["asc-api-key-id"],
        appId: args["app-id"],
        bundleIdentifier: args["bundle-identifier"],
      }),
    });
  });
