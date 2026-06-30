/**
 * App Store **phased release** ("staged rollout") operations on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs `app-store rollout`: start a phased
 * release, report its progress, and pause / resume / complete it. A phased
 * release ramps an automatically-released update to 1%→2%→…→100% of users over
 * seven days.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** A phased release projected to the fields the CLI surfaces. */
export interface RolloutView {
  readonly versionString: string;
  readonly state: string;
  readonly currentDayNumber: number | null;
  readonly startDate: string | null;
}

const toView = (
  versionString: string,
  phased: AppleUtils.AppStoreVersionPhasedRelease,
): RolloutView => ({
  versionString,
  state: phased.attributes.phasedReleaseState ?? "UNKNOWN",
  currentDayNumber: phased.attributes.currentDayNumber,
  startDate: phased.attributes.startDate,
});

/**
 * Resolve the version a rollout applies to. Precedence: the version awaiting
 * release, then the live version, then the editable version (so a rollout can be
 * pre-configured before submission). Returns the raw entity for mutation.
 */
const resolveRolloutVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const version = yield* wrapConnect("apple-resolve-rollout-version", async () => {
      const pending = await app.getPendingReleaseAppStoreVersionAsync({ platform });
      if (pending !== null) {
        return pending;
      }
      const live = await app.getLiveAppStoreVersionAsync({ platform });
      if (live !== null) {
        return live;
      }
      return app.getEditAppStoreVersionAsync({ platform });
    });
    if (version === null) {
      return yield* new AppStoreError({
        message: "No App Store version found to roll out.",
      });
    }
    return version;
  });

/** Fetch the phased release for the resolved rollout version, failing if there is none. */
const requirePhasedRelease = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const version = yield* resolveRolloutVersion(ctx, appId, platform);
    const phased = yield* wrapConnect("apple-get-phased-release", async () =>
      version.getPhasedReleaseAsync(),
    );
    if (phased === null) {
      return yield* new AppStoreError({
        message:
          "No phased release is active for this version. Start one with `app-store rollout start`.",
      });
    }
    return { versionString: version.attributes.versionString, phased };
  });

/** Start a phased (staged) release for the rollout version. Idempotent. */
export const startRollout = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const version = yield* resolveRolloutVersion(ctx, appId, platform);
    const existing = yield* wrapConnect("apple-get-phased-release", async () =>
      version.getPhasedReleaseAsync(),
    );
    if (existing !== null) {
      return toView(version.attributes.versionString, existing);
    }
    const phased = yield* wrapConnect("apple-create-phased-release", async () =>
      version.createPhasedReleaseAsync({
        state: AppleUtils.PhasedReleaseState.ACTIVE,
      }),
    );
    return toView(version.attributes.versionString, phased);
  });

/** Report the phased release status, or `null` when none is configured. */
export const rolloutStatus = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const version = yield* resolveRolloutVersion(ctx, appId, platform);
    const phased = yield* wrapConnect("apple-get-phased-release", async () =>
      version.getPhasedReleaseAsync(),
    );
    return phased === null ? null : toView(version.attributes.versionString, phased);
  });

const transitionRollout =
  (
    step: string,
    apply: (
      phased: AppleUtils.AppStoreVersionPhasedRelease,
    ) => Promise<AppleUtils.AppStoreVersionPhasedRelease>,
  ) =>
  (ctx: AppleUtils.RequestContext, appId: string, platform: AppleUtils.Platform) =>
    Effect.gen(function* () {
      const { versionString, phased } = yield* requirePhasedRelease(ctx, appId, platform);
      const updated = yield* wrapConnect(step, async () => apply(phased));
      return toView(versionString, updated);
    });

/** Pause an active phased release. */
export const pauseRollout = transitionRollout("apple-pause-phased-release", async (phased) =>
  phased.pauseAsync(),
);

/** Resume a paused phased release. */
export const resumeRollout = transitionRollout("apple-resume-phased-release", async (phased) =>
  phased.resumeAsync(),
);

/** Complete a phased release immediately (release to 100% of users now). */
export const completeRollout = transitionRollout("apple-complete-phased-release", async (phased) =>
  phased.completeAsync(),
);
