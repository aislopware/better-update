/**
 * App Review **Resolution Center** communication on the `@expo/apple-utils` Iris
 * entity layer. Backs the `app-review` command group (list threads, read a
 * transcript, see rejection reasons, reply). These endpoints are **cookie-only**:
 * apple-utils doc-annotates every Resolution Center class _"NOT available with API
 * key (JWT) authentication"_, so the commands take an Apple ID session
 * ({@link openCookieAppSession}) and degrade with `InteractiveProhibitedError` in CI.
 *
 * Threads anchor on the app's in-progress review submission (which includes the
 * rejected `UNRESOLVED_ISSUES` state — exactly when App Review chat is live).
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";

/** A Resolution Center thread projected to the fields the CLI surfaces. */
export interface ThreadView {
  readonly id: string;
  readonly threadType: string;
  readonly state: string;
  readonly createdDate: string;
  readonly lastMessageResponseDate: string;
}

const toThreadView = (thread: AppleUtils.ResolutionCenterThread): ThreadView => ({
  id: thread.id,
  threadType: thread.attributes.threadType,
  state: thread.attributes.state,
  createdDate: thread.attributes.createdDate,
  lastMessageResponseDate: thread.attributes.lastMessageResponseDate,
});

/** Crudely render Apple's HTML `messageBody` as plain text for the human view. */
const htmlToPlain = (html: string): string =>
  html
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/<\/p>/giu, "\n")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();

/** Resolve the app's in-progress review submission, or `null` when none is open. */
const getInProgressSubmission = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* wrapConnect("apple-get-app", async () =>
      AppleUtils.App.infoAsync(ctx, { id: appId }),
    );
    return yield* wrapConnect("apple-get-in-progress-submission", async () =>
      app.getInProgressReviewSubmissionAsync({ platform }),
    );
  });

/** List the App Review (Resolution Center) threads for the app's open submission. */
export const listThreads = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const submission = yield* getInProgressSubmission(ctx, appId, platform);
    if (submission === null) {
      return [];
    }
    const threads = yield* wrapConnect("apple-list-threads", async () =>
      submission.getResolutionCenterThreadsAsync(),
    );
    return threads.map(toThreadView);
  });

/** Resolve one thread by id from the app's open submission, failing clearly when absent. */
const getThread = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  threadId: string,
) =>
  Effect.gen(function* () {
    const submission = yield* getInProgressSubmission(ctx, appId, platform);
    if (submission === null) {
      return yield* new AppStoreError({
        message: "No in-progress review submission, so there are no App Review threads.",
      });
    }
    const threads = yield* wrapConnect("apple-list-threads", async () =>
      submission.getResolutionCenterThreadsAsync(),
    );
    const thread = threads.find((entry) => entry.id === threadId);
    if (thread === undefined) {
      return yield* new AppStoreError({
        message: `App Review thread ${threadId} not found. Run \`better-update app-review list\` to see thread ids.`,
      });
    }
    return thread;
  });

export interface MessageView {
  readonly createdDate: string;
  /** Raw HTML message body (machine view). */
  readonly body: string;
  /** Plain-text rendering (human view). */
  readonly text: string;
}

/** Read a thread's full transcript (newest Apple/developer messages). */
export const viewThread = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  threadId: string,
) =>
  Effect.gen(function* () {
    const thread = yield* getThread(ctx, appId, platform, threadId);
    const messages = yield* wrapConnect("apple-get-thread-messages", async () =>
      thread.getResolutionCenterMessagesAsync(),
    );
    return {
      thread: toThreadView(thread),
      messages: messages.map(
        (message): MessageView => ({
          createdDate: message.attributes.createdDate,
          body: message.attributes.messageBody,
          text: htmlToPlain(message.attributes.messageBody),
        }),
      ),
    };
  });

export interface RejectionView {
  readonly section: string;
  readonly code: string;
  readonly description: string;
}

/** Fetch the guideline rejection reasons attached to a thread. */
export const threadRejections = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  threadId: string,
) =>
  Effect.gen(function* () {
    const thread = yield* getThread(ctx, appId, platform, threadId);
    const rejections = yield* wrapConnect("apple-fetch-rejection-reasons", async () =>
      thread.fetchRejectionReasonsAsync(),
    );
    return rejections.flatMap((rejection) =>
      rejection.attributes.reasons.map(
        (reason): RejectionView => ({
          section: reason.reasonSection,
          code: reason.reasonCode,
          description: reason.reasonDescription,
        }),
      ),
    );
  });

/** Post a reply to App Review on a thread (text only — Apple's Iris has no attachment model). */
export const replyToThread = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  threadId: string,
  messageBody: string,
) =>
  Effect.gen(function* () {
    const thread = yield* getThread(ctx, appId, platform, threadId);
    const message = yield* wrapConnect("apple-send-reply", async () =>
      thread.sendReplyAsync({ messageBody }),
    );
    return { threadId, createdDate: message.attributes.createdDate };
  });
