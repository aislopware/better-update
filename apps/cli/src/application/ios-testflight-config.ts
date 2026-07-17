/**
 * Post-upload TestFlight configuration for iOS submissions. After `altool`
 * uploads the `.ipa`, App Store Connect spends several minutes *processing* the
 * binary before it can be configured. This module waits for that processing to
 * finish, then sets the build's "What to Test" text and assigns it to internal
 * TestFlight groups — the same follow-up `eas submit` performs server-side.
 *
 * The build is resolved by its **CFBundleVersion** (the build number in the IPA),
 * not by diffing against a pre-upload snapshot. That makes configuration
 * idempotent: a re-run after a metadata failure finds the *same* already-uploaded
 * build and re-applies the config, instead of dead-ending because the binary
 * cannot be uploaded twice.
 *
 * Auth reuses the ASC **API key** already decrypted for the upload via a headless
 * `@expo/apple-utils` JWT context (no second credential prompt, no cookie login).
 * Failures surface as {@link TestFlightConfigError} so the caller can record the
 * submission as metadata-incomplete with a precise reason.
 */
import { toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Data, Duration, Effect } from "effect";

import { buildTokenRequestContext, wrapConnect } from "../lib/apple-asc-connect";
import { printHuman } from "../lib/output";
import { explainWhatsNewApiError } from "../lib/whats-new";

import type { AscCredentials } from "../lib/asc-credentials";

export class TestFlightConfigError extends Data.TaggedError("TestFlightConfigError")<{
  readonly code: string;
  readonly message: string;
}> {}

const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_LOCALE = "en-US";

/** Run an apple-utils call, mapping any failure to a coded {@link TestFlightConfigError}. */
const call = <T>(code: string, step: string, run: () => Promise<T>) =>
  wrapConnect(step, run).pipe(
    Effect.mapError((error) => new TestFlightConfigError({ code, message: error.message })),
  );

/** Apple's build processing lifecycle. `valid` = ready for TestFlight config. */
export type AscBuildProcessingState = "processing" | "valid" | "failed";

/** Classify a raw `processingState`. Unknown/absent states stay `processing`
 * so the poller keeps waiting rather than failing early. */
export const classifyProcessingState = (state: string | null): AscBuildProcessingState => {
  if (state === "VALID") {
    return "valid";
  }
  if (state === "FAILED" || state === "INVALID") {
    return "failed";
  }
  return "processing";
};

export const matchBetaGroupsByName = <T extends { readonly name: string }>(
  groups: readonly T[],
  names: readonly string[],
): { readonly matched: readonly T[]; readonly missing: readonly string[] } => {
  const byName = new Map(groups.map((group) => [group.name, group] as const));
  const matched: T[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const group = byName.get(name);
    if (group === undefined) {
      missing.push(name);
    } else {
      matched.push(group);
    }
  }
  return { matched, missing };
};

/**
 * Resolve the ASC app id, preferring the explicit `ascAppId` and otherwise
 * looking the app up by its bundle identifier. Needed to scope build/group
 * queries and to run the pre-upload "is this build already there?" check.
 */
export const resolveTestFlightAppId = (params: {
  readonly credentials: AscCredentials;
  readonly ascAppId: string | undefined;
  readonly bundleIdentifier: string;
}): Effect.Effect<string, TestFlightConfigError> =>
  Effect.gen(function* () {
    if (params.ascAppId !== undefined) {
      return params.ascAppId;
    }
    const ctx = buildTokenRequestContext(params.credentials);
    const app = yield* call("TESTFLIGHT_APP_LOOKUP_FAILED", "apple-find-app", async () =>
      AppleUtils.App.findAsync(ctx, { bundleId: params.bundleIdentifier }),
    );
    if (app === null) {
      return yield* new TestFlightConfigError({
        code: "TESTFLIGHT_APP_NOT_FOUND",
        message: `No App Store Connect app found for bundle id ${params.bundleIdentifier}. Set ascAppId in the eas.json submit profile.`,
      });
    }
    return app.id;
  });

/**
 * Find the uploaded build for a CFBundleVersion (the ASC `Build.version`),
 * returning `null` when none exists yet, else the newest match. Apple dedupes
 * uploads per (marketing version, build number) pair, so when `shortVersion`
 * is known the lookup is scoped to that version train — a bare build-number
 * match would false-positive against an older train that reused the number.
 */
export const findBuildByVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  buildVersion: string,
  shortVersion?: string,
): Effect.Effect<AppleUtils.Build | null, TestFlightConfigError> =>
  Effect.gen(function* () {
    const builds = yield* call("TESTFLIGHT_LIST_BUILDS_FAILED", "apple-list-builds", async () =>
      AppleUtils.Build.getAsync(ctx, {
        query: {
          filter: {
            app: appId,
            version: buildVersion,
            ...(shortVersion === undefined ? {} : { "preReleaseVersion.version": shortVersion }),
          },
          sort: "-uploadedDate",
          limit: 10,
        },
      }),
    );
    return toDbNull(builds[0]);
  });

const pollForProcessedBuild = (params: {
  readonly ctx: AppleUtils.RequestContext;
  readonly appId: string;
  readonly buildVersion: string;
  readonly shortVersion: string | undefined;
  readonly pollTimeoutMs: number;
  readonly pollIntervalMs: number;
}) =>
  Effect.gen(function* () {
    const deadline = Date.now() + params.pollTimeoutMs;
    const final = yield* Effect.iterate(
      { build: null as AppleUtils.Build | null, attempt: 0 },
      {
        while: (state) => state.build === null,
        body: (state) =>
          Effect.gen(function* () {
            if (state.attempt > 0) {
              yield* Effect.sleep(Duration.millis(params.pollIntervalMs));
            }
            const candidate = yield* findBuildByVersion(
              params.ctx,
              params.appId,
              params.buildVersion,
              params.shortVersion,
            );
            if (candidate !== null) {
              const processing = classifyProcessingState(candidate.attributes.processingState);
              if (processing === "failed") {
                return yield* new TestFlightConfigError({
                  code: "TESTFLIGHT_BUILD_PROCESSING_FAILED",
                  message: `App Store Connect rejected build ${candidate.attributes.version} during processing (state ${candidate.attributes.processingState}).`,
                });
              }
              if (processing === "valid") {
                return { build: candidate, attempt: state.attempt + 1 };
              }
            }
            if (Date.now() > deadline) {
              return yield* new TestFlightConfigError({
                code: "TESTFLIGHT_BUILD_PROCESSING_TIMEOUT",
                message: `Timed out after ${String(Math.round(params.pollTimeoutMs / 60_000))} min waiting for the uploaded build to finish processing on App Store Connect. The binary uploaded successfully — re-run submit (it will skip the upload and just configure TestFlight).`,
              });
            }
            yield* printHuman(
              candidate === null
                ? "Waiting for the uploaded build to appear on App Store Connect..."
                : "Build is processing on App Store Connect...",
            );
            return { build: null, attempt: state.attempt + 1 };
          }),
      },
    );
    if (final.build === null) {
      return yield* new TestFlightConfigError({
        code: "TESTFLIGHT_BUILD_NOT_FOUND",
        message: "Could not locate the uploaded build on App Store Connect.",
      });
    }
    return final.build;
  });

const applyWhatToTest = (params: {
  readonly ctx: AppleUtils.RequestContext;
  readonly build: AppleUtils.Build;
  readonly locale: string;
  readonly whatToTest: string;
}) =>
  Effect.gen(function* () {
    const localizations = yield* call(
      "TESTFLIGHT_LIST_LOCALIZATIONS_FAILED",
      "apple-list-localizations",
      async () => params.build.getBetaBuildLocalizationsAsync(),
    );
    const existing = localizations.find((loc) => loc.attributes.locale === params.locale);
    yield* call("TESTFLIGHT_SET_WHAT_TO_TEST_FAILED", "apple-set-what-to-test", async () => {
      if (existing === undefined) {
        const created = await AppleUtils.BetaBuildLocalization.createAsync(params.ctx, {
          id: params.build.id,
          locale: params.locale,
        });
        await created.updateAsync({ whatsNew: params.whatToTest });
        return;
      }
      await existing.updateAsync({ whatsNew: params.whatToTest });
    }).pipe(Effect.mapError(explainWhatToTestError));
  });

/** Rewrite ASC's opaque "too short" rejection on the set-what-to-test step. */
const explainWhatToTestError = (error: TestFlightConfigError): TestFlightConfigError => {
  const explained = explainWhatsNewApiError(error.message);
  return explained === null
    ? error
    : new TestFlightConfigError({ code: error.code, message: explained });
};

const applyGroups = (params: {
  readonly ctx: AppleUtils.RequestContext;
  readonly appId: string;
  readonly build: AppleUtils.Build;
  readonly groups: readonly string[];
}) =>
  Effect.gen(function* () {
    const allGroups = yield* call("TESTFLIGHT_LIST_GROUPS_FAILED", "apple-list-groups", async () =>
      AppleUtils.BetaGroup.getAsync(params.ctx, { query: { filter: { app: params.appId } } }),
    );
    const named = allGroups.map((group) => ({ id: group.id, name: group.attributes.name }));
    const { matched, missing } = matchBetaGroupsByName(named, params.groups);
    if (missing.length > 0) {
      const available = named.map((group) => group.name).join(", ") || "(none)";
      return yield* new TestFlightConfigError({
        code: "TESTFLIGHT_GROUP_NOT_FOUND",
        message: `TestFlight group(s) not found: ${missing.join(", ")}. Available groups: ${available}.`,
      });
    }
    yield* call("TESTFLIGHT_ADD_TO_GROUPS_FAILED", "apple-add-to-groups", async () =>
      params.build.addBetaGroupsAsync({ betaGroups: matched.map((group) => group.id) }),
    );
  });

export interface ApplyTestFlightConfigInputs {
  readonly credentials: AscCredentials;
  readonly appId: string;
  /** CFBundleVersion of the uploaded build to configure. */
  readonly buildVersion: string;
  /** CFBundleShortVersionString, to scope the build lookup to its version train. */
  readonly shortVersion?: string | undefined;
  readonly language: string | undefined;
  readonly whatToTest: string | undefined;
  readonly groups: readonly string[];
  readonly pollTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

/** Whether a profile has any TestFlight config that warrants the processing wait. */
export const needsTestFlightConfig = (params: {
  readonly whatToTest: string | undefined;
  readonly groups: readonly string[];
}): boolean => params.whatToTest !== undefined || params.groups.length > 0;

export const applyTestFlightConfig = (inputs: ApplyTestFlightConfigInputs) =>
  Effect.gen(function* () {
    const ctx = buildTokenRequestContext(inputs.credentials);
    yield* printHuman("Configuring TestFlight (waiting for build processing)...");
    const build = yield* pollForProcessedBuild({
      ctx,
      appId: inputs.appId,
      buildVersion: inputs.buildVersion,
      shortVersion: inputs.shortVersion,
      pollTimeoutMs: inputs.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      pollIntervalMs: inputs.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    if (inputs.whatToTest !== undefined) {
      yield* applyWhatToTest({
        ctx,
        build,
        locale: inputs.language ?? DEFAULT_LOCALE,
        whatToTest: inputs.whatToTest,
      });
      yield* printHuman(`Set "What to Test" on build ${build.attributes.version}.`);
    }

    if (inputs.groups.length > 0) {
      yield* applyGroups({
        ctx,
        appId: inputs.appId,
        build,
        groups: inputs.groups,
      });
      yield* printHuman(`Assigned build to TestFlight group(s): ${inputs.groups.join(", ")}.`);
    }

    return { buildId: build.id, buildVersion: build.attributes.version };
  });
