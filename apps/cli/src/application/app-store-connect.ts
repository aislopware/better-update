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
import { Config, Effect } from "effect";
import { Flag } from "effect/unstable/cli";

import { wrapConnect } from "../lib/apple-asc-connect";
import { ascKeyRequestContext } from "../lib/credentials-generator-apple";
import { readSubmitProfile } from "../lib/eas-json";
import { AppStoreError, InvalidArgumentError } from "../lib/exit-codes";
import { optionalFlag } from "../lib/params";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { resolveSubmitProfileAscApiKeyId } from "./asc-key-resolve";

import type { EasIosSubmitProfile } from "../lib/eas-config";
import type { ApiClient } from "../services/api-client";

/**
 * Citty args every ASC leaf needs to authenticate (no app resolution): which
 * submit profile to read config from, plus a per-run API key override. Spread
 * into account-scoped leaves (`credentials certificate list`, `apple users list`,
 * `app-store apps list`) that resolve a {@link AscContext} via {@link openAscContext}.
 */
export const ASC_AUTH_ARGS = {
  profile: Flag.String("profile").pipe(
    Flag.withDescription(
      "eas.json submit profile to read App Store Connect config from (default: production)",
    ),
    Flag.withDefault("production"),
  ),
  "asc-api-key-id": Flag.String("asc-api-key-id").pipe(
    Flag.withDescription(
      "Stored ASC API key id to authenticate with (overrides the submit profile's ascApiKeyId)",
    ),
    optionalFlag,
  ),
};

/**
 * Citty args shared by every app-scoped ASC leaf: {@link ASC_AUTH_ARGS} plus the
 * per-run app id / bundle id overrides. Spread into a leaf's `args` alongside its
 * command-specific flags; resolve with {@link openAscSession}.
 */
export const ASC_COMMON_ARGS = {
  ...ASC_AUTH_ARGS,
  "app-id": Flag.String("app-id").pipe(
    Flag.withDescription(
      "App Store Connect app id (overrides the profile's ascAppId / bundle-id lookup)",
    ),
    optionalFlag,
  ),
  "bundle-identifier": Flag.String("bundle-identifier").pipe(
    Flag.withDescription("Bundle id used to resolve the app when no app id is configured"),
    optionalFlag,
  ),
};

/**
 * Citty args for selecting an uploaded ASC build by id or CFBundleVersion. Spread
 * into TestFlight leaves that act on a build; resolve with `resolveBuild`.
 */
export const BUILD_SELECTOR_ARGS = {
  build: Flag.String("build").pipe(Flag.withDescription("ASC build id"), optionalFlag),
  "build-version": Flag.String("build-version").pipe(
    Flag.withDescription("Uploaded build's CFBundleVersion (build number)"),
    optionalFlag,
  ),
};

/** The parsed shape of {@link ASC_AUTH_ARGS} a leaf passes to {@link openAscContext}. */
export interface AscAuthArgs {
  readonly profile: string;
  readonly "asc-api-key-id"?: string | undefined;
}

/** The parsed shape of {@link ASC_COMMON_ARGS} a leaf passes to {@link openAscSession}. */
export interface AscCommonArgs extends AscAuthArgs {
  readonly "app-id"?: string | undefined;
  readonly "bundle-identifier"?: string | undefined;
}

/** A resolved headless Token context (no app), for account-scoped commands. */
export interface AscContext {
  readonly ctx: AppleUtils.RequestContext;
  readonly ascApiKeyId: string;
}

/** A resolved headless App Store Connect session, ready to drive entity managers. */
export interface AscSession extends AscContext {
  readonly appId: string;
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
/** `--platform` for the store-side commands; parse with {@link normalizePlatform} (accepts aliases). */
export const ASC_PLATFORM_FLAG = Flag.String("platform").pipe(
  Flag.withDescription("Platform: ios (default), mac, tv, vision"),
  Flag.withDefault("ios"),
);

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

/**
 * Validate `raw` against the member values of a string-enum object (read off the
 * apple-utils default import, e.g. `AppleUtils.AppCategoryId`) and return it typed
 * as that enum member. Pin the member type at the call site:
 * `coerceEnum<AppleUtils.AppCategoryId>(AppleUtils.AppCategoryId, raw, "category")`.
 * Used by the metadata commands that take an enum-id flag.
 */
export const coerceEnum = <V extends string>(
  enumObject: object,
  raw: string,
  label: string,
): Effect.Effect<V, InvalidArgumentError> => {
  // `Object.values` on a string-enum object yields its member-value strings.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- string enum: every member value is a string
  const values = Object.values(enumObject) as string[];
  if (!values.includes(raw)) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `Unknown ${label} "${raw}". Valid values: ${values.join(", ")}.`,
      }),
    );
  }
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- raw was just validated to be one of the enum's member values
  return Effect.succeed(raw as V);
};

/** Env var the App Review demo-account password is sourced from when no flag is passed. */
const DEMO_PASSWORD_ENV = "BETTER_UPDATE_DEMO_ACCOUNT_PASSWORD";

/**
 * Shared flags for an App Review / beta review detail (contact + demo
 * account). Used by `app-store review-detail set` and `testflight review
 * set-detail`. Parse with {@link resolveReviewDetailInput}.
 */
export const REVIEW_DETAIL_ARGS = {
  "contact-email": Flag.String("contact-email").pipe(
    Flag.withDescription("Review contact email"),
    optionalFlag,
  ),
  "contact-first-name": Flag.String("contact-first-name").pipe(
    Flag.withDescription("Review contact first name"),
    optionalFlag,
  ),
  "contact-last-name": Flag.String("contact-last-name").pipe(
    Flag.withDescription("Review contact last name"),
    optionalFlag,
  ),
  "contact-phone": Flag.String("contact-phone").pipe(
    Flag.withDescription("Review contact phone number"),
    optionalFlag,
  ),
  "demo-account-name": Flag.String("demo-account-name").pipe(
    Flag.withDescription("Demo account username for App Review"),
    optionalFlag,
  ),
  "demo-account-password": Flag.String("demo-account-password").pipe(
    Flag.withDescription(
      `Demo account password (or set ${DEMO_PASSWORD_ENV} to avoid shell history)`,
    ),
    Flag.withFallbackConfig(Config.String(DEMO_PASSWORD_ENV)),
    optionalFlag,
  ),
  "demo-required": Flag.Boolean("demo-required").pipe(
    Flag.withDescription("Mark the demo account as required (--no-demo-required to clear)"),
    optionalFlag,
  ),
  notes: Flag.String("notes").pipe(Flag.withDescription("Notes for the reviewer"), optionalFlag),
};

/** The parsed shape of {@link REVIEW_DETAIL_ARGS}. */
export interface ReviewDetailArgs {
  readonly "contact-email"?: string | undefined;
  readonly "contact-first-name"?: string | undefined;
  readonly "contact-last-name"?: string | undefined;
  readonly "contact-phone"?: string | undefined;
  readonly "demo-account-name"?: string | undefined;
  readonly "demo-account-password"?: string | undefined;
  readonly "demo-required"?: boolean | undefined;
  readonly notes?: string | undefined;
}

/** The normalized review-detail attributes both review-detail leaves write. */
export interface ReviewDetailInput {
  readonly contactEmail?: string;
  readonly contactFirstName?: string;
  readonly contactLastName?: string;
  readonly contactPhone?: string;
  readonly demoAccountName?: string;
  readonly demoAccountPassword?: string;
  readonly demoAccountRequired?: boolean;
  readonly notes?: string;
}

/**
 * Build the review-detail attributes from flags, sourcing the demo password from
 * {@link DEMO_PASSWORD_ENV} when no `--demo-account-password` is passed. The
 * password is never echoed. Only provided fields are included.
 */
export const resolveReviewDetailInput = (
  args: ReviewDetailArgs,
): Effect.Effect<ReviewDetailInput, InvalidArgumentError> =>
  Effect.gen(function* () {
    const demoAccountRequired = args["demo-required"];
    const demoAccountPassword = args["demo-account-password"];
    return compact({
      contactEmail: args["contact-email"],
      contactFirstName: args["contact-first-name"],
      contactLastName: args["contact-last-name"],
      contactPhone: args["contact-phone"],
      demoAccountName: args["demo-account-name"],
      demoAccountPassword,
      demoAccountRequired,
      notes: args.notes,
    });
  });

interface ResolveAscContextInput {
  readonly api: ApiClient;
  /** Project root holding `eas.json`, for reading the submit profile. */
  readonly projectRoot: string;
  readonly profileName: string;
  readonly ascApiKeyId?: string;
}

interface ResolveAscSessionInput extends ResolveAscContextInput {
  readonly appId?: string;
  readonly bundleIdentifier?: string;
}

/**
 * Read the eas.json submit profile's iOS block, tolerating absence (unlinked
 * project). Exported for the cookie session resolver (`asc-cookie-session.ts`).
 */
export const loadSubmitProfile = (projectRoot: string, profileName: string) =>
  readSubmitProfile(projectRoot, profileName).pipe(
    Effect.map((resolved) => resolved.ios),
    Effect.orElseSucceed<EasIosSubmitProfile | undefined>(() => undefined),
  );

/** Build the Token context + resolved key id from flags/profile (no app resolution). */
const buildAscContext = (params: {
  readonly api: ApiClient;
  readonly profile: EasIosSubmitProfile | undefined;
  readonly flagKeyId: string | undefined;
  readonly projectRoot: string;
  readonly profileName: string;
}) =>
  Effect.gen(function* () {
    const ascApiKeyId = yield* resolveSubmitProfileAscApiKeyId({
      api: params.api,
      flagKeyId: params.flagKeyId,
      profileKeyId: params.profile?.ascApiKeyId,
      projectRoot: params.projectRoot,
      profileName: params.profileName,
    });
    const ctx = yield* ascKeyRequestContext(params.api, ascApiKeyId);
    return { ctx, ascApiKeyId } satisfies AscContext;
  });

/**
 * Resolve the target App id: flag > profile ascAppId > `App.findAsync` by bundle
 * id. Exported for the cookie session resolver (`asc-cookie-session.ts`).
 */
export const resolveAppId = (params: {
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
 * Resolve a headless {@link AscContext} (Token + key id, no app) from the submit
 * profile + flag overrides. For account-scoped commands that operate on the team,
 * not a single app (certificates, bundle ids, users, the app list).
 */
export const resolveAscContext = (input: ResolveAscContextInput) =>
  Effect.gen(function* () {
    const profile = yield* loadSubmitProfile(input.projectRoot, input.profileName);
    return yield* buildAscContext({
      api: input.api,
      profile,
      flagKeyId: input.ascApiKeyId,
      projectRoot: input.projectRoot,
      profileName: input.profileName,
    });
  });

/**
 * Resolve a full {@link AscSession} from the submit profile + flag overrides. A
 * missing/invalid submit profile is tolerated when flags supply everything (an
 * unlinked project can still target an app by `--app-id` + `--asc-api-key-id`).
 */
export const resolveAscSession = (input: ResolveAscSessionInput) =>
  Effect.gen(function* () {
    const profile = yield* loadSubmitProfile(input.projectRoot, input.profileName);
    const { ctx, ascApiKeyId } = yield* buildAscContext({
      api: input.api,
      profile,
      flagKeyId: input.ascApiKeyId,
      projectRoot: input.projectRoot,
      profileName: input.profileName,
    });
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
 * Resolve an {@link AscContext} straight from a leaf's parsed auth args. The entry
 * point every account-scoped (non-app) ASC leaf calls.
 */
export const openAscContext = (args: AscAuthArgs) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    return yield* resolveAscContext({
      api,
      projectRoot,
      profileName: args.profile,
      ...compact({ ascApiKeyId: args["asc-api-key-id"] }),
    });
  });

/**
 * Resolve an {@link AscSession} straight from a leaf's parsed common args,
 * pulling the api client + project root from the CLI services. The single entry
 * point every app-scoped `app-store`/`testflight` leaf calls.
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
