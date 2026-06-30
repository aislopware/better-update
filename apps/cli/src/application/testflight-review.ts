/**
 * TestFlight **external beta review** operations on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs `testflight review`: submit a build
 * for external beta review, report/withdraw the submission, and set the app's
 * beta review detail (contact + demo account). All Token/CI-safe.
 */
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** A beta review submission projected to the fields the CLI surfaces. */
export interface BetaReviewView {
  readonly buildId: string;
  readonly state: string;
  readonly submittedDate: string | null;
  readonly alreadySubmitted: boolean;
}

/**
 * Submit a build for external TestFlight beta review. Idempotent: an existing
 * submission is reported rather than re-created (Apple permits one per build).
 */
export const submitBetaReview = (build: AppleUtils.Build) =>
  Effect.gen(function* () {
    const existing = yield* wrapConnect("apple-get-beta-review-submission", async () =>
      build.getBetaAppReviewSubmissionAsync(),
    );
    const submission =
      existing ??
      (yield* wrapConnect("apple-create-beta-review-submission", async () =>
        build.createBetaAppReviewSubmissionAsync(),
      ));
    return {
      buildId: build.id,
      state: submission.attributes.betaReviewState,
      submittedDate: submission.attributes.submittedDate,
      alreadySubmitted: existing !== null,
    } satisfies BetaReviewView;
  });

/** Report a build's beta review submission state, or `null` when none was submitted. */
export const betaReviewStatus = (build: AppleUtils.Build) =>
  wrapConnect("apple-get-beta-review-submission", async () =>
    build.getBetaAppReviewSubmissionAsync(),
  ).pipe(
    Effect.map((submission) =>
      submission === null
        ? null
        : {
            buildId: build.id,
            state: submission.attributes.betaReviewState,
            submittedDate: submission.attributes.submittedDate,
          },
    ),
  );

/** Withdraw a build's in-flight beta review submission. Fails clearly when none exists. */
export const withdrawBetaReview = (build: AppleUtils.Build) =>
  Effect.gen(function* () {
    const submission = yield* wrapConnect("apple-get-beta-review-submission", async () =>
      build.getBetaAppReviewSubmissionAsync(),
    );
    if (submission === null) {
      return yield* new AppStoreError({
        message: "No TestFlight beta review submission to withdraw for this build.",
      });
    }
    yield* wrapConnect("apple-withdraw-beta-review-submission", async () =>
      submission.deleteAsync(),
    );
    return { buildId: build.id, withdrawn: true };
  });

export interface BetaReviewDetailInput {
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
 * Set the app-level beta review detail (review contact + demo account) — a
 * prerequisite for external beta review. The demo password is never echoed.
 */
export const setBetaReviewDetail = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: BetaReviewDetailInput,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const attributes = compact({ ...input });
    if (Object.keys(attributes).length === 0) {
      return yield* new AppStoreError({
        message:
          "Nothing to set. Pass at least one of --contact-email, --contact-first-name, --contact-last-name, --contact-phone, --demo-account-name, --demo-account-password, --demo-required, --notes.",
      });
    }
    const detail = yield* wrapConnect("apple-update-beta-review-detail", async () =>
      app.updateBetaAppReviewDetailAsync(attributes),
    );
    return {
      contactEmail: detail.attributes.contactEmail,
      demoAccountRequired: detail.attributes.demoAccountRequired,
      fields: Object.keys(attributes),
    };
  });
