import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { appStoreStatus } from "../../application/app-store-review";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printHumanTable } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface StatusArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appStoreStatusCommand = defineCommand({
  meta: {
    name: "status",
    description:
      "Show the App Store release pipeline: editable, in-review, pending, and live versions",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: StatusArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
