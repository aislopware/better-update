import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { appStoreStatus } from "../../application/app-store-review";
import { printHuman, printHumanTable } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appStoreStatusCommand = Command.make(
  "status",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const status = yield* appStoreStatus(session.ctx, session.appId, platform);
      yield* printHumanTable(
        ["Slot", "Version", "State"],
        status.slots.map((slot) => [slot.slot, slot.versionString ?? "—", slot.state ?? "—"]),
      );
      yield* printHuman(
        status.reviewSubmission === null
          ? "Review submission: none in progress."
          : `Review submission: ${status.reviewSubmission.state} (${status.reviewSubmission.id}).`,
      );
      return status;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Show the App Store release pipeline: editable, in-review, pending, and live versions",
  ),
);
