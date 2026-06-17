/**
 * Post-upload TestFlight configuration for iOS submissions. After `altool`
 * uploads the `.ipa`, App Store Connect spends several minutes *processing* the
 * binary before it can be configured. This module waits for that processing to
 * finish, then sets the build's "What to Test" text and assigns it to internal
 * TestFlight groups — the same follow-up `eas submit` performs server-side.
 *
 * Auth reuses the ASC **API key** already decrypted for the upload (no second
 * credential prompt). Failures surface as {@link TestFlightConfigError} so the
 * caller can mark the submission ERRORED with a precise reason.
 */
import { toDbNull } from "@better-update/type-guards";
import { Data, Duration, Effect } from "effect";

import {
  addBuildToBetaGroups,
  classifyProcessingState,
  createBetaBuildLocalization,
  getAppByBundleId,
  listBetaGroups,
  listBuildBetaLocalizations,
  listRecentBuilds,
  matchBetaGroupsByName,
  pickNewBuild,
  updateBetaBuildLocalization,
} from "../lib/apple-asc-testflight";
import { printHuman } from "../lib/output";

import type { AscCredentials, AscError } from "../lib/apple-asc-client";
import type { AscBuild } from "../lib/apple-asc-testflight";

export class TestFlightConfigError extends Data.TaggedError("TestFlightConfigError")<{
  readonly code: string;
  readonly message: string;
}> {}

const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_LOCALE = "en-US";

const ascErrorMessage = (error: AscError): string => {
  if (error._tag === "AscApiError") {
    return `App Store Connect API error ${String(error.status)}: ${error.message}`;
  }
  if (error._tag === "AscNetworkError") {
    return `App Store Connect network error: ${String(error.cause)}`;
  }
  return `App Store Connect auth error: ${String(error.cause)}`;
};

const wrapAsc = (code: string) => (error: AscError) =>
  new TestFlightConfigError({ code, message: ascErrorMessage(error) });

export interface TestFlightAppContext {
  readonly appId: string;
  /** Newest build id before upload, so the new build can be told apart. */
  readonly baselineLatestBuildId: string | null;
}

/**
 * Resolve the ASC app id (preferring the explicit `ascAppId`) and snapshot the
 * latest existing build. Run this *before* `altool` so the freshly-uploaded
 * build can be distinguished from prior ones.
 */
export const captureTestFlightContext = (params: {
  readonly credentials: AscCredentials;
  readonly ascAppId: string | undefined;
  readonly bundleIdentifier: string;
}): Effect.Effect<TestFlightAppContext, TestFlightConfigError> =>
  Effect.gen(function* () {
    const appId =
      params.ascAppId ??
      (yield* Effect.gen(function* () {
        const app = yield* getAppByBundleId(params.credentials, params.bundleIdentifier).pipe(
          Effect.mapError(wrapAsc("TESTFLIGHT_APP_LOOKUP_FAILED")),
        );
        if (app === null) {
          return yield* new TestFlightConfigError({
            code: "TESTFLIGHT_APP_NOT_FOUND",
            message: `No App Store Connect app found for bundle id ${params.bundleIdentifier}. Set ascAppId in the eas.json submit profile.`,
          });
        }
        return app.id;
      }));
    const existing = yield* listRecentBuilds(params.credentials, appId, 1).pipe(
      Effect.mapError(wrapAsc("TESTFLIGHT_LIST_BUILDS_FAILED")),
    );
    return { appId, baselineLatestBuildId: toDbNull(existing[0]?.id) };
  });

const pollForProcessedBuild = (params: {
  readonly credentials: AscCredentials;
  readonly context: TestFlightAppContext;
  readonly pollTimeoutMs: number;
  readonly pollIntervalMs: number;
}) =>
  Effect.gen(function* () {
    const deadline = Date.now() + params.pollTimeoutMs;
    const final = yield* Effect.iterate(
      { build: null as AscBuild | null, attempt: 0 },
      {
        while: (state) => state.build === null,
        body: (state) =>
          Effect.gen(function* () {
            if (state.attempt > 0) {
              yield* Effect.sleep(Duration.millis(params.pollIntervalMs));
            }
            const builds = yield* listRecentBuilds(
              params.credentials,
              params.context.appId,
              20,
            ).pipe(Effect.mapError(wrapAsc("TESTFLIGHT_LIST_BUILDS_FAILED")));
            const candidate = pickNewBuild(builds, params.context.baselineLatestBuildId);
            if (candidate !== null) {
              const processing = classifyProcessingState(candidate.processingState);
              if (processing === "failed") {
                return yield* new TestFlightConfigError({
                  code: "TESTFLIGHT_BUILD_PROCESSING_FAILED",
                  message: `App Store Connect rejected build ${candidate.version ?? candidate.id} during processing (state ${candidate.processingState ?? "unknown"}).`,
                });
              }
              if (processing === "valid") {
                return { build: candidate, attempt: state.attempt + 1 };
              }
            }
            if (Date.now() > deadline) {
              return yield* new TestFlightConfigError({
                code: "TESTFLIGHT_BUILD_PROCESSING_TIMEOUT",
                message: `Timed out after ${String(Math.round(params.pollTimeoutMs / 60_000))} min waiting for the uploaded build to finish processing on App Store Connect. The binary uploaded successfully — re-run the TestFlight configuration later.`,
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
  readonly credentials: AscCredentials;
  readonly buildId: string;
  readonly locale: string;
  readonly whatToTest: string;
}) =>
  Effect.gen(function* () {
    const localizations = yield* listBuildBetaLocalizations(
      params.credentials,
      params.buildId,
    ).pipe(Effect.mapError(wrapAsc("TESTFLIGHT_LIST_LOCALIZATIONS_FAILED")));
    const existing = localizations.find((loc) => loc.locale === params.locale);
    yield* (
      existing === undefined
        ? createBetaBuildLocalization(params.credentials, {
            buildId: params.buildId,
            locale: params.locale,
            whatsNew: params.whatToTest,
          })
        : updateBetaBuildLocalization(params.credentials, {
            id: existing.id,
            whatsNew: params.whatToTest,
          })
    ).pipe(Effect.mapError(wrapAsc("TESTFLIGHT_SET_WHAT_TO_TEST_FAILED")));
  });

const applyGroups = (params: {
  readonly credentials: AscCredentials;
  readonly appId: string;
  readonly buildId: string;
  readonly groups: readonly string[];
}) =>
  Effect.gen(function* () {
    const allGroups = yield* listBetaGroups(params.credentials, params.appId).pipe(
      Effect.mapError(wrapAsc("TESTFLIGHT_LIST_GROUPS_FAILED")),
    );
    const { matched, missing } = matchBetaGroupsByName(allGroups, params.groups);
    if (missing.length > 0) {
      const available = allGroups.map((group) => group.name).join(", ") || "(none)";
      return yield* new TestFlightConfigError({
        code: "TESTFLIGHT_GROUP_NOT_FOUND",
        message: `TestFlight group(s) not found: ${missing.join(", ")}. Available groups: ${available}.`,
      });
    }
    yield* addBuildToBetaGroups(
      params.credentials,
      params.buildId,
      matched.map((group) => group.id),
    ).pipe(Effect.mapError(wrapAsc("TESTFLIGHT_ADD_TO_GROUPS_FAILED")));
  });

export interface ApplyTestFlightConfigInputs {
  readonly credentials: AscCredentials;
  readonly context: TestFlightAppContext;
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
    yield* printHuman("Configuring TestFlight (waiting for build processing)...");
    const build = yield* pollForProcessedBuild({
      credentials: inputs.credentials,
      context: inputs.context,
      pollTimeoutMs: inputs.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      pollIntervalMs: inputs.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    if (inputs.whatToTest !== undefined) {
      yield* applyWhatToTest({
        credentials: inputs.credentials,
        buildId: build.id,
        locale: inputs.language ?? DEFAULT_LOCALE,
        whatToTest: inputs.whatToTest,
      });
      yield* printHuman(`Set "What to Test" on build ${build.version ?? build.id}.`);
    }

    if (inputs.groups.length > 0) {
      yield* applyGroups({
        credentials: inputs.credentials,
        appId: inputs.context.appId,
        buildId: build.id,
        groups: inputs.groups,
      });
      yield* printHuman(`Assigned build to TestFlight group(s): ${inputs.groups.join(", ")}.`);
    }

    return { buildId: build.id, buildVersion: build.version };
  });
