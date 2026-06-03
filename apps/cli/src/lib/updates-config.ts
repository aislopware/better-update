import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import { InvalidArgumentError } from "./exit-codes";

import type { ExpoConfig } from "./expo-config";

/**
 * Pure helpers for the full expo-updates config surface written by
 * `update configure`. All fields live under `expo.updates` in app.json
 * except `runtimeVersion`, which is top-level.
 *
 * Field names / enums / defaults mirror `@expo/config-types` (SDK 56). The
 * critical default is `enableBsdiffPatchSupport: true` — the device-side
 * toggle that makes the device send `A-IM: bsdiff` and accept bsdiff-patched
 * bundle responses. Without it the entire server-side bsdiff content
 * negotiation is inert.
 */

export type RuntimePolicy = "sdkVersion" | "nativeVersion" | "appVersion" | "fingerprint";

export const RUNTIME_POLICIES: readonly RuntimePolicy[] = [
  "sdkVersion",
  "nativeVersion",
  "appVersion",
  "fingerprint",
];

export type CheckAutomatically = "ON_LOAD" | "ON_ERROR_RECOVERY" | "WIFI_ONLY" | "NEVER";

export const CHECK_AUTOMATICALLY_VALUES: readonly CheckAutomatically[] = [
  "ON_LOAD",
  "ON_ERROR_RECOVERY",
  "WIFI_ONLY",
  "NEVER",
];

/** Native `EXUpdatesLaunchWaitMs` clamp. `fallbackToCacheTimeout` range (ms). */
export const FALLBACK_TIMEOUT_MIN = 0;
export const FALLBACK_TIMEOUT_MAX = 300_000;

/** Defaults for the expo-updates surface configure writes (SDK 56). */
export const CONFIGURE_DEFAULTS = {
  runtimePolicy: "appVersion",
  enabled: true,
  checkAutomatically: "ON_LOAD",
  fallbackToCacheTimeout: 0,
  useEmbeddedUpdate: true,
  enableBsdiffPatchSupport: true,
  // off = anti-bricking measures ACTIVE = safe; only flip on if you know why.
  disableAntiBrickingMeasures: false,
} as const;

export const isRuntimePolicy = (value: string): value is RuntimePolicy =>
  (RUNTIME_POLICIES as readonly string[]).includes(value);

export const isCheckAutomatically = (value: string): value is CheckAutomatically =>
  (CHECK_AUTOMATICALLY_VALUES as readonly string[]).includes(value);

/**
 * Validate `--runtime-policy`. `undefined` (flag not passed) is allowed through
 * so callers can preserve an existing value instead of forcing a default.
 */
export const validateRuntimePolicy = (
  value: string | undefined,
): Effect.Effect<RuntimePolicy | undefined, InvalidArgumentError> => {
  if (value === undefined) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (RuntimePolicy | undefined); Effect.void breaks exactOptionalPropertyTypes
    return Effect.succeed(undefined);
  }
  return isRuntimePolicy(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new InvalidArgumentError({
          message: `Invalid --runtime-policy "${value}". Use one of: ${RUNTIME_POLICIES.join(", ")}.`,
        }),
      );
};

/**
 * Validate `--check-automatically` against the expo-updates enum. `undefined`
 * (flag not passed) is allowed through so callers can preserve an existing value.
 */
export const validateCheckAutomatically = (
  value: string | undefined,
): Effect.Effect<CheckAutomatically | undefined, InvalidArgumentError> => {
  if (value === undefined) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (CheckAutomatically | undefined); Effect.void breaks exactOptionalPropertyTypes
    return Effect.succeed(undefined);
  }
  return isCheckAutomatically(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new InvalidArgumentError({
          message: `Invalid --check-automatically "${value}". Use one of: ${CHECK_AUTOMATICALLY_VALUES.join(", ")}.`,
        }),
      );
};

/**
 * Validate `--fallback-timeout` (citty parses numeric flags as strings).
 * Must be an integer in `[0, 300000]` ms. `undefined` (flag not passed) is
 * allowed through so callers can preserve an existing value.
 */
export const validateFallbackTimeout = (
  value: number | string | undefined,
): Effect.Effect<number | undefined, InvalidArgumentError> => {
  if (value === undefined) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (number | undefined); Effect.void breaks exactOptionalPropertyTypes
    return Effect.succeed(undefined);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < FALLBACK_TIMEOUT_MIN || parsed > FALLBACK_TIMEOUT_MAX) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `Invalid --fallback-timeout "${value}". Expected an integer between ${FALLBACK_TIMEOUT_MIN} and ${FALLBACK_TIMEOUT_MAX} (milliseconds).`,
      }),
    );
  }
  return Effect.succeed(parsed);
};

/**
 * The slice of an existing Expo config `update configure` reads before
 * (re)writing. Every field is optional — a fresh project has none of them. The
 * builder falls back to these values whenever the user did not pass the
 * matching flag, so `--force` merges with (rather than clobbers) prior values.
 */
export interface ExistingUpdatesConfig {
  readonly runtimePolicy?: RuntimePolicy | undefined;
  readonly enabled?: boolean | undefined;
  readonly checkAutomatically?: CheckAutomatically | undefined;
  readonly fallbackToCacheTimeout?: number | undefined;
  readonly useEmbeddedUpdate?: boolean | undefined;
  readonly enableBsdiffPatchSupport?: boolean | undefined;
  readonly disableAntiBrickingMeasures?: boolean | undefined;
  readonly requestHeaders?: Record<string, string> | undefined;
}

/**
 * Explicitly-passed `update configure` flag values. `undefined` means "the flag
 * was not passed" (citty leaves unset flags `undefined` when they have no
 * default) — the builder preserves the existing config value in that case. The
 * `manifestUrl` is always recomputed from the project, so it has no `undefined`
 * variant and is never preserved.
 */
export interface UpdatesConfigInput {
  readonly manifestUrl: string;
  readonly runtimePolicy?: RuntimePolicy | undefined;
  readonly enabled?: boolean | undefined;
  readonly checkAutomatically?: CheckAutomatically | undefined;
  readonly fallbackToCacheTimeout?: number | undefined;
  readonly useEmbeddedUpdate?: boolean | undefined;
  readonly enableBsdiffPatchSupport?: boolean | undefined;
  readonly disableAntiBrickingMeasures?: boolean | undefined;
  /** `undefined` (or omitted) leaves existing request headers untouched. */
  readonly requestHeaders?: Record<string, string> | undefined;
  /**
   * Existing `updates.*` values read from the Expo config. Used to preserve any
   * field the user did not explicitly pass. Omit for a fresh configure.
   */
  readonly existing?: ExistingUpdatesConfig | undefined;
}

export interface ExpoUpdatesPatch {
  readonly runtimeVersion: { readonly policy: RuntimePolicy };
  readonly updates: {
    readonly url: string;
    readonly enabled: boolean;
    readonly checkAutomatically: CheckAutomatically;
    readonly fallbackToCacheTimeout: number;
    readonly useEmbeddedUpdate: boolean;
    readonly enableBsdiffPatchSupport: boolean;
    readonly disableAntiBrickingMeasures: boolean;
    readonly requestHeaders?: Record<string, string>;
  };
  // A config patch is an open object deep-merged into app.json; the index
  // signature both reflects that and makes the patch assignable to the
  // `Record<string, unknown>` parameter of `writeExpoConfigPatch`.
  readonly [key: string]: unknown;
}

/**
 * Resolve a single field as `explicit ?? existing ?? default`: use the flag the
 * user passed, else preserve the existing config value, else fall back to the
 * documented default. Keeps `--force` from resetting fields the user didn't
 * touch (e.g. flipping `--enable-bsdiff` leaves a prior `checkAutomatically`).
 */
const resolveField = <T>(explicit: T | undefined, existing: T | undefined, fallback: T): T =>
  explicit ?? existing ?? fallback;

/**
 * Build the deep-merge patch handed to `modifyConfigAsync`. Only the keys
 * present here are merged into the existing config — unrelated keys are
 * preserved by `@expo/config`. Each `updates.*` field resolves as
 * `explicit flag ?? existing value ?? default`, so re-running configure (even
 * with `--force`) preserves values the user did not pass. `requestHeaders` is
 * omitted entirely when neither passed nor previously set so we never clobber
 * existing headers with an empty object.
 */
export const buildUpdatesPatch = (input: UpdatesConfigInput): ExpoUpdatesPatch => {
  const existing = input.existing ?? {};
  return {
    runtimeVersion: {
      policy: resolveField(
        input.runtimePolicy,
        existing.runtimePolicy,
        CONFIGURE_DEFAULTS.runtimePolicy,
      ),
    },
    updates: {
      url: input.manifestUrl,
      enabled: resolveField(input.enabled, existing.enabled, CONFIGURE_DEFAULTS.enabled),
      checkAutomatically: resolveField(
        input.checkAutomatically,
        existing.checkAutomatically,
        CONFIGURE_DEFAULTS.checkAutomatically,
      ),
      fallbackToCacheTimeout: resolveField(
        input.fallbackToCacheTimeout,
        existing.fallbackToCacheTimeout,
        CONFIGURE_DEFAULTS.fallbackToCacheTimeout,
      ),
      useEmbeddedUpdate: resolveField(
        input.useEmbeddedUpdate,
        existing.useEmbeddedUpdate,
        CONFIGURE_DEFAULTS.useEmbeddedUpdate,
      ),
      enableBsdiffPatchSupport: resolveField(
        input.enableBsdiffPatchSupport,
        existing.enableBsdiffPatchSupport,
        CONFIGURE_DEFAULTS.enableBsdiffPatchSupport,
      ),
      disableAntiBrickingMeasures: resolveField(
        input.disableAntiBrickingMeasures,
        existing.disableAntiBrickingMeasures,
        CONFIGURE_DEFAULTS.disableAntiBrickingMeasures,
      ),
      ...compact({ requestHeaders: input.requestHeaders ?? existing.requestHeaders }),
    },
  };
};

const extractExistingRuntimePolicy = (
  runtimeVersion: ExpoConfig["runtimeVersion"],
): RuntimePolicy | undefined => {
  // typeof null === "object" — guard before reading `policy` so a cleared
  // `runtimeVersion: null` from a dynamic config falls through to undefined.
  // eslint-disable-next-line typescript/no-unnecessary-condition -- runtime guard against `runtimeVersion: null` even though the static type excludes null
  if (typeof runtimeVersion !== "object" || runtimeVersion === null) {
    return undefined;
  }
  return isRuntimePolicy(runtimeVersion.policy) ? runtimeVersion.policy : undefined;
};

/**
 * Read the existing expo-updates surface from a resolved Expo config into the
 * shape `buildUpdatesPatch` preserves. Only values matching the documented
 * enums are carried over; anything unrecognized falls through to `undefined`
 * so the default applies. A string `runtimeVersion` (an explicit version, not a
 * policy) is treated as "no policy set".
 */
export const extractExistingUpdatesConfig = (config: ExpoConfig): ExistingUpdatesConfig => {
  const { updates } = config;
  return compact({
    runtimePolicy: extractExistingRuntimePolicy(config.runtimeVersion),
    enabled: typeof updates?.enabled === "boolean" ? updates.enabled : undefined,
    checkAutomatically:
      updates?.checkAutomatically !== undefined && isCheckAutomatically(updates.checkAutomatically)
        ? updates.checkAutomatically
        : undefined,
    fallbackToCacheTimeout:
      typeof updates?.fallbackToCacheTimeout === "number"
        ? updates.fallbackToCacheTimeout
        : undefined,
    useEmbeddedUpdate:
      typeof updates?.useEmbeddedUpdate === "boolean" ? updates.useEmbeddedUpdate : undefined,
    enableBsdiffPatchSupport:
      typeof updates?.enableBsdiffPatchSupport === "boolean"
        ? updates.enableBsdiffPatchSupport
        : undefined,
    disableAntiBrickingMeasures:
      typeof updates?.disableAntiBrickingMeasures === "boolean"
        ? updates.disableAntiBrickingMeasures
        : undefined,
    requestHeaders: updates?.requestHeaders,
  });
};

/** Key/value rows describing the written fields, for human + JSON output. */
export const describeUpdatesPatch = (
  patch: ExpoUpdatesPatch,
): readonly (readonly [string, string])[] => {
  const { updates } = patch;
  const rows: (readonly [string, string])[] = [
    ["runtimeVersion.policy", patch.runtimeVersion.policy],
    ["updates.url", updates.url],
    ["updates.enabled", String(updates.enabled)],
    ["updates.checkAutomatically", updates.checkAutomatically],
    ["updates.fallbackToCacheTimeout", String(updates.fallbackToCacheTimeout)],
    ["updates.useEmbeddedUpdate", String(updates.useEmbeddedUpdate)],
    ["updates.enableBsdiffPatchSupport", String(updates.enableBsdiffPatchSupport)],
    ["updates.disableAntiBrickingMeasures", String(updates.disableAntiBrickingMeasures)],
  ];
  if (updates.requestHeaders) {
    rows.push(["updates.requestHeaders", JSON.stringify(updates.requestHeaders)]);
  }
  return rows;
};

/**
 * Parse a `--request-header KEY=VALUE` repeatable flag (citty supplies a
 * string or array of strings). Returns `undefined` when no headers were
 * passed so callers can omit the field from the patch.
 */
const toEntries = (raw: string | readonly string[]): readonly string[] =>
  typeof raw === "string" ? [raw] : raw;

const parseHeaderEntry = (
  entry: string,
): Effect.Effect<readonly [string, string], InvalidArgumentError> => {
  const separator = entry.indexOf("=");
  const key = separator === -1 ? "" : entry.slice(0, separator).trim();
  if (separator === -1 || key === "") {
    return Effect.fail(
      new InvalidArgumentError({
        message: `Invalid --request-header "${entry}". Expected KEY=VALUE.`,
      }),
    );
  }
  return Effect.succeed([key, entry.slice(separator + 1)]);
};

export const parseRequestHeaders = (
  raw: string | readonly string[] | undefined,
): Effect.Effect<Record<string, string> | undefined, InvalidArgumentError> => {
  if (raw === undefined) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (Record<string, string> | undefined); Effect.void breaks exactOptionalPropertyTypes
    return Effect.succeed(undefined);
  }
  const entries = toEntries(raw);
  if (entries.length === 0) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (Record<string, string> | undefined); Effect.void breaks exactOptionalPropertyTypes
    return Effect.succeed(undefined);
  }
  return Effect.gen(function* () {
    const headers: Record<string, string> = {};
    for (const entry of entries) {
      const [key, value] = yield* parseHeaderEntry(entry);
      headers[key] = value;
    }
    return headers;
  });
};
