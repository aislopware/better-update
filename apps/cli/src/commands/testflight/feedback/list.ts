import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { listFeedback, resolveFeedbackBuildId } from "../../../application/testflight-feedback";
import { findTesterByEmail } from "../../../application/testflight-testers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHumanList } from "../../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

import type { FeedbackKind, FeedbackView } from "../../../application/testflight-feedback";

const KINDS: Readonly<Record<string, readonly FeedbackKind[]>> = {
  all: ["screenshot", "crash"],
  screenshot: ["screenshot"],
  crash: ["crash"],
};

/**
 * Parse `--type`. The lookup is guarded with `Object.hasOwn` so inherited
 * `Object.prototype` keys (`constructor`, `__proto__`) are rejected as invalid
 * input instead of passing the validity check and crashing downstream.
 */
export const parseKinds = (
  raw: string | undefined,
): Effect.Effect<readonly FeedbackKind[], InvalidArgumentError> => {
  const key = (raw ?? "all").trim().toLowerCase();
  const kinds = Object.hasOwn(KINDS, key) ? KINDS[key] : undefined;
  if (kinds === undefined) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `--type must be screenshot, crash, or all, got "${key}".`,
      }),
    );
  }
  return Effect.succeed(kinds);
};

const COMMENT_WIDTH = 60;
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Render a tester's comment as one table cell. Tester comments are the only
 * fully untrusted text this CLI prints, so control characters (ESC, backspace,
 * CR) are neutralised before they can rewrite the drawn table, and the truncation
 * cuts on a grapheme boundary so an emoji is never split into a lone surrogate.
 */
export const oneLine = (comment: string | null): string => {
  if (comment === null) {
    return "—";
  }
  const flat = comment
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const cells = Array.from(GRAPHEMES.segment(flat), (segment) => segment.segment);
  if (cells.length === 0) {
    return "—";
  }
  return cells.length > COMMENT_WIDTH ? `${cells.slice(0, COMMENT_WIDTH - 1).join("")}…` : flat;
};

const toRow = (feedback: FeedbackView): readonly string[] => [
  feedback.createdDate,
  feedback.kind,
  feedback.email ?? "—",
  feedback.build?.version ?? feedback.build?.id ?? "—",
  feedback.deviceModel,
  feedback.osVersion,
  feedback.kind === "screenshot" ? String(feedback.screenshots.length) : "—",
  oneLine(feedback.comment),
  feedback.id,
];

export const feedbackListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    type: Flag.String("type").pipe(
      Flag.withDescription("Which feedback to list: screenshot, crash, or all (default: all)"),
      Flag.withDefault("all"),
    ),
    platform: Flag.String("platform").pipe(
      Flag.withDescription("Filter by app platform: ios, mac, tv, vision"),
      optionalFlag,
    ),
    "device-model": Flag.String("device-model").pipe(
      Flag.withDescription("Filter by device model identifier (e.g. iPhone14,2)"),
      optionalFlag,
    ),
    "os-version": Flag.String("os-version").pipe(
      Flag.withDescription("Filter by OS version (e.g. 18.2)"),
      optionalFlag,
    ),
    "tester-email": Flag.String("tester-email").pipe(
      Flag.withDescription("Filter by the tester who sent the feedback"),
      optionalFlag,
    ),
    limit: positiveIntFlag("limit", { description: "Max entries to return", defaultValue: 50 }),
  },
  Effect.fn(
    function* (args) {
      const kinds = yield* parseKinds(args.type);
      const platform =
        args.platform === undefined ? undefined : yield* normalizePlatform(args.platform);
      const { limit } = args;
      const session = yield* openAscSession(args);
      const buildId = yield* resolveFeedbackBuildId(session.ctx, session.appId, {
        buildId: args.build,
        buildVersion: args["build-version"],
        platform,
      });
      const testerId =
        args["tester-email"] === undefined
          ? undefined
          : (yield* findTesterByEmail(session.ctx, args["tester-email"])).id;
      const items = yield* listFeedback(session.ctx, session.appId, {
        kinds,
        buildId,
        deviceModel: args["device-model"],
        osVersion: args["os-version"],
        platform,
        testerId,
        limit,
      });
      yield* printHumanList(
        ["Submitted", "Type", "Tester", "Build", "Device", "OS", "Shots", "Comment", "ID"],
        items.map(toRow),
        "No TestFlight feedback found.",
      );
      return { items };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List TestFlight tester feedback (screenshots + crashes), newest first (CI-safe)",
  ),
);
