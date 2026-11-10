/**
 * App Store Connect needs time to propagate a newly created app before an
 * upload can name it: for several minutes (25 have been seen) the Build Upload
 * API reserve call answers HTTP 409 "'<id>' is not a valid ID for this
 * relationship" and `altool` reports "The provided entity includes a
 * relationship with an invalid value", even though `GET /v1/apps` already lists
 * the app. Both are transient, so the submit waits and retries them for a
 * bounded time instead of failing.
 */
import { Clock, Duration, Effect } from "effect";

import { printHuman } from "./output";

import type { AscErrorList } from "./asc-build-upload-parse";
import type { OutputMode } from "./output-mode";

/** Error code both uploaders use for "the ASC app is not ready for uploads yet". */
export const APP_NOT_READY_CODE = "ASC_APP_NOT_READY";

/** Minutes to keep retrying; `0` turns the wait off. */
export const APP_NOT_READY_WAIT_ENV = "BETTER_UPDATE_ASC_APP_WAIT_MINUTES";

const DEFAULT_WAIT_MINUTES = 30;
const FIRST_DELAY_MS = 15_000;
const MAX_DELAY_MS = 120_000;

const RELATIONSHIP_INVALID_CODE = "ENTITY_ERROR.RELATIONSHIP.INVALID";
const NOT_A_VALID_RELATIONSHIP_ID = /not a valid id for this relationship/iu;

/** True when a reserve 409 says the app relationship id is not (yet) valid. */
export const isAppNotReadyConflict = (status: number, errors: AscErrorList): boolean =>
  status === 409 &&
  errors.some(
    (error) =>
      error.code?.startsWith(RELATIONSHIP_INVALID_CODE) === true ||
      (error.detail !== undefined && NOT_A_VALID_RELATIONSHIP_ID.test(error.detail)),
  );

/** True when an altool failure is the same not-yet-propagated app relationship. */
export const isAltoolAppNotReady = (detail: string): boolean =>
  /relationship with an invalid value/iu.test(detail) || NOT_A_VALID_RELATIONSHIP_ID.test(detail);

/** Guidance appended to a not-ready failure, whether the wait ran out or was off. */
export const APP_NOT_READY_HINT =
  "App Store Connect has not finished setting up this app for uploads; a newly created app can take up to about 30 minutes. Re-run the submit later, and check that ascAppId names this app.";

/** The retry budget from {@link APP_NOT_READY_WAIT_ENV}, in milliseconds. */
export const appNotReadyBudgetMillis = (env: Readonly<Record<string, string | undefined>>) => {
  const raw = env[APP_NOT_READY_WAIT_ENV]?.trim();
  const minutes = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_WAIT_MINUTES) * 60_000;
};

/** Delay before retry `attempt` (0-based): 15s, doubling, capped at 2 min. */
export const appNotReadyDelayMillis = (attempt: number): number =>
  Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);

const formatMinutes = (millis: number) => `${String(Math.round(millis / 60_000))} min`;

/**
 * Run `upload`, retrying while it fails with {@link APP_NOT_READY_CODE} until
 * the next retry would pass `budgetMillis`; then the last failure surfaces.
 * Only reserve-phase failures carry that code, so a retry never re-sends bytes
 * the Build Upload API already accepted.
 */
export const retryWhileAppNotReady = <
  Success,
  Failure extends { readonly _tag: string; readonly code?: string },
  Requirements,
>(
  upload: Effect.Effect<Success, Failure, Requirements>,
  params: { readonly appId: string | null; readonly budgetMillis: number },
): Effect.Effect<Success, Failure, Requirements | OutputMode> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const app = params.appId === null ? "the app" : `app ${params.appId}`;
    const attempt = (index: number): Effect.Effect<Success, Failure, Requirements | OutputMode> =>
      upload.pipe(
        Effect.catchIf(
          (error) => error.code === APP_NOT_READY_CODE,
          (error) =>
            Effect.gen(function* () {
              const waited = (yield* Clock.currentTimeMillis) - startedAt;
              const delay = appNotReadyDelayMillis(index);
              if (waited + delay > params.budgetMillis) {
                return yield* Effect.fail(error);
              }
              yield* printHuman(
                `App Store Connect is still setting up ${app} for uploads — retrying in ${String(delay / 1000)}s (waited ${formatMinutes(waited)} of up to ${formatMinutes(params.budgetMillis)}).`,
              );
              yield* Effect.sleep(Duration.millis(delay));
              return yield* attempt(index + 1);
            }),
        ),
      );
    return yield* attempt(0);
  });
