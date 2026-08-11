import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { listFeedback, resolveFeedbackBuildId } from "../../../application/testflight-feedback";
import { findTesterByEmail } from "../../../application/testflight-testers";
import { runEffect } from "../../../lib/citty-effect";
import { parseLimit } from "../../../lib/cli-schemas";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";
import type { FeedbackKind, FeedbackView } from "../../../application/testflight-feedback";

interface FeedbackListArgs extends AscCommonArgs {
  readonly type?: string | undefined;
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
  readonly platform?: string | undefined;
  readonly "device-model"?: string | undefined;
  readonly "os-version"?: string | undefined;
  readonly "tester-email"?: string | undefined;
  readonly limit?: string | undefined;
}

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

export const feedbackListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List TestFlight tester feedback (screenshots + crashes), newest first (CI-safe)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    type: {
      type: "string",
      default: "all",
      description: "Which feedback to list: screenshot, crash, or all (default: all)",
    },
    platform: { type: "string", description: "Filter by app platform: ios, mac, tv, vision" },
    "device-model": {
      type: "string",
      description: "Filter by device model identifier (e.g. iPhone14,2)",
    },
    "os-version": { type: "string", description: "Filter by OS version (e.g. 18.2)" },
    "tester-email": { type: "string", description: "Filter by the tester who sent the feedback" },
    limit: { type: "string", default: "50", description: "Max entries to return (default: 50)" },
  },
  run: async ({ args }: { readonly args: FeedbackListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const kinds = yield* parseKinds(args.type);
        const platform =
          args.platform === undefined ? undefined : yield* normalizePlatform(args.platform);
        const limit = yield* parseLimit(args.limit, 50);
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
