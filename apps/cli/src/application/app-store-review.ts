import { Effect } from "effect";

/**
 * App Store **review pipeline** operations on the headless ASC
 * (`@expo/apple-utils`) entity layer: submit the editable version for review,
 * report the app's review status, and release an approved version. Backs
 * `app-store submit`, `app-store status`, and `app-store release`.
 */
import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** One row of {@link appStoreStatus}: a version slot and its current occupant. */
export interface StatusSlot {
  readonly slot: string;
  readonly versionString: string | null;
  readonly state: string | null;
}

const slotOf = (slot: string, version: AppleUtils.AppStoreVersion | null): StatusSlot => {
  if (version === null) {
    return { slot, versionString: null, state: null };
  }
  return {
    slot,
    versionString: version.attributes.versionString,
    // eslint-disable-next-line typescript/no-deprecated -- legacy display fallback: appVersionState is null on pre-3.3 versions
    state: version.attributes.appVersionState ?? version.attributes.appStoreState,
  };
};

export interface AppStoreStatus {
  readonly slots: readonly StatusSlot[];
  readonly reviewSubmission: { readonly id: string; readonly state: string } | null;
}

/**
 * Read-only snapshot of an app's release pipeline: which version occupies each
 * lifecycle slot (editable, in review, pending release, live) plus any
 * in-progress review submission.
 */
export const appStoreStatus = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const [edit, inReview, pending, live, submission] = yield* wrapConnect(
      "apple-app-store-status",
      async () =>
        Promise.all([
          app.getEditAppStoreVersionAsync({ platform }),
          app.getInReviewAppStoreVersionAsync({ platform }),
          app.getPendingReleaseAppStoreVersionAsync({ platform }),
          app.getLiveAppStoreVersionAsync({ platform }),
          app.getInProgressReviewSubmissionAsync({ platform }),
        ] as const),
    );
    return {
      slots: [
        slotOf("editable", edit),
        slotOf("in-review", inReview),
        slotOf("pending-release", pending),
        slotOf("live", live),
      ],
      reviewSubmission:
        submission === null ? null : { id: submission.id, state: submission.attributes.state },
    } satisfies AppStoreStatus;
  });

export interface SubmitResult {
  readonly submissionId: string;
  readonly versionString: string;
  readonly state: string;
  readonly alreadyInProgress: boolean;
}

/**
 * Submit the editable App Store version for review. Idempotent: when a review
 * submission is already in progress it is reported rather than duplicated
 * (Apple permits only one in-flight submission per app).
 */
export const submitForReview = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const inProgress = yield* wrapConnect("apple-get-in-progress-submission", async () =>
      app.getInProgressReviewSubmissionAsync({ platform }),
    );
    const editVersion = yield* wrapConnect("apple-get-edit-version", async () =>
      app.getEditAppStoreVersionAsync({ platform }),
    );
    if (editVersion === null) {
      return yield* new AppStoreError({
        message:
          "No editable App Store version to submit. Create one and attach a build with `app-store version create` / `app-store version set`.",
      });
    }
    if (inProgress !== null) {
      return {
        submissionId: inProgress.id,
        versionString: editVersion.attributes.versionString,
        state: inProgress.attributes.state,
        alreadyInProgress: true,
      } satisfies SubmitResult;
    }
    const submission = yield* wrapConnect("apple-create-review-submission", async () =>
      app.createReviewSubmissionAsync({ platform }),
    );
    yield* wrapConnect("apple-add-version-to-submission", async () =>
      submission.addAppStoreVersionToReviewItems(editVersion.id),
    );
    yield* wrapConnect("apple-submit-for-review", async () => submission.submitForReviewAsync());
    return {
      submissionId: submission.id,
      versionString: editVersion.attributes.versionString,
      state: "WAITING_FOR_REVIEW",
      alreadyInProgress: false,
    } satisfies SubmitResult;
  });

export interface ReleaseResult {
  readonly versionId: string;
  readonly versionString: string;
}

/**
 * Release the version that is approved and awaiting manual developer release
 * (the "Pending Developer Release" state). Fails clearly when no version is
 * waiting — e.g. the version is set to automatic release, or not yet approved.
 */
export const releaseVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const pending = yield* wrapConnect("apple-get-pending-release", async () =>
      app.getPendingReleaseAppStoreVersionAsync({ platform }),
    );
    if (pending === null) {
      return yield* new AppStoreError({
        message:
          "No version is pending developer release. Only an approved version set to manual release can be released this way.",
      });
    }
    yield* wrapConnect("apple-create-release-request", async () =>
      pending.createReleaseRequestAsync(),
    );
    return {
      versionId: pending.id,
      versionString: pending.attributes.versionString,
    } satisfies ReleaseResult;
  });
