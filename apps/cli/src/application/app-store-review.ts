import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

/**
 * App Store **review pipeline** operations on the headless ASC
 * (`@expo/apple-utils`) entity layer: submit the editable version for review,
 * report the app's review status, release an approved version, set the review
 * detail (contact + demo account), cancel an in-progress submission, and
 * developer-reject a version. Backs `app-store submit`/`status`/`release`/
 * `review-detail set`/`cancel`/`reject`.
 */
import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp, getEditableVersion } from "./app-store-versions";

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
 * Submit the editable App Store version for review. Idempotent: an already
 * in-progress submission is reported rather than duplicated, and a submission
 * that was created but not yet submitted (an interrupted prior run, which sits in
 * `READY_FOR_REVIEW` — outside the in-progress filter) is resumed rather than
 * re-created, since Apple permits only one open submission per app.
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
    // Resume a created-but-unsubmitted submission (READY_FOR_REVIEW) rather than
    // creating a second one, which Apple would reject with a 409.
    const ready = yield* wrapConnect("apple-get-ready-submission", async () =>
      app.getReadyReviewSubmissionAsync({ platform }),
    );
    const submission =
      ready ??
      (yield* wrapConnect("apple-create-review-submission", async () =>
        app.createReviewSubmissionAsync({ platform }),
      ));
    const items = yield* wrapConnect("apple-get-submission-items", async () =>
      submission.getReviewSubmissionItemsAsync(),
    );
    if (items.length === 0) {
      yield* wrapConnect("apple-add-version-to-submission", async () =>
        submission.addAppStoreVersionToReviewItems(editVersion.id),
      );
    }
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
 * Create the review detail, then patch `demoAccountRequired` separately —
 * `createReviewDetailAsync` does not accept it at create time.
 */
const createReviewDetail = (version: AppleUtils.AppStoreVersion, attributes: ReviewDetailInput) =>
  Effect.gen(function* () {
    const { demoAccountRequired, ...rest } = attributes;
    const created = yield* wrapConnect("apple-create-review-detail", async () =>
      version.createReviewDetailAsync(rest),
    );
    if (demoAccountRequired === undefined) {
      return created;
    }
    return yield* wrapConnect("apple-update-review-detail", async () =>
      created.updateAsync({ demoAccountRequired }),
    );
  });

/**
 * Set the App Review detail (contact + demo account) on the editable version,
 * creating it when absent. `createReviewDetailAsync` cannot take
 * `demoAccountRequired`, so a fresh detail is created then patched with it. The
 * demo password is never echoed.
 */
export const setReviewDetail = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: ReviewDetailInput,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const attributes = compact({ ...input });
    if (Object.keys(attributes).length === 0) {
      return yield* new AppStoreError({
        message:
          "Nothing to set. Pass at least one of --contact-email, --contact-first-name, --contact-last-name, --contact-phone, --demo-account-name, --demo-account-password, --demo-required, --notes.",
      });
    }
    const existing = yield* wrapConnect("apple-get-review-detail", async () =>
      version.getAppStoreReviewDetailAsync(),
    );
    const detail =
      existing === null
        ? yield* createReviewDetail(version, attributes)
        : yield* wrapConnect("apple-update-review-detail", async () =>
            existing.updateAsync(attributes),
          );
    return {
      versionId: version.id,
      demoAccountRequired: detail.attributes.demoAccountRequired,
      fields: Object.keys(attributes),
    };
  });

/** Cancel the app's in-progress App Review submission. Fails clearly when none is in flight. */
export const cancelReview = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const submission = yield* wrapConnect("apple-get-in-progress-submission", async () =>
      app.getInProgressReviewSubmissionAsync({ platform }),
    );
    if (submission === null) {
      return yield* new AppStoreError({
        message: "No in-progress review submission to cancel.",
      });
    }
    yield* wrapConnect("apple-cancel-submission", async () => submission.cancelSubmissionAsync());
    return { submissionId: submission.id, cancelled: true };
  });

/**
 * Developer-reject the version that is in review (or the editable one), pulling it
 * back from App Review. Gated on Apple's `canReject()` so it fails clearly when
 * the version is not in a rejectable state.
 */
export const rejectVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const version = yield* wrapConnect("apple-resolve-rejectable-version", async () => {
      const inReview = await app.getInReviewAppStoreVersionAsync({ platform });
      if (inReview !== null) {
        return inReview;
      }
      return app.getEditAppStoreVersionAsync({ platform });
    });
    if (version === null) {
      return yield* new AppStoreError({ message: "No App Store version to reject." });
    }
    if (!version.canReject()) {
      return yield* new AppStoreError({
        message: `Version ${version.attributes.versionString} cannot be developer-rejected in its current state.`,
      });
    }
    yield* wrapConnect("apple-reject-version", async () => version.rejectAsync());
    return {
      versionId: version.id,
      versionString: version.attributes.versionString,
      rejected: true,
    };
  });
