import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { syncMedia } from "../../../application/app-store-media";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanTable } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface MediaSyncArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly dir?: string | undefined;
  readonly prune: boolean;
  readonly "dry-run": boolean;
}

export const mediaSyncCommand = defineCommand({
  meta: {
    name: "sync",
    description:
      "Sync a screenshots/<locale>/<device>/*.png tree to the editable version (each local set replaces its remote)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    dir: {
      type: "string",
      description: "Root directory holding <locale>/<device>/*.png (required)",
    },
    prune: {
      type: "boolean",
      default: false,
      description: "Also empty remote device sets a present locale does not declare locally",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print the plan without uploading or deleting anything",
    },
  },
  run: async ({ args }: { readonly args: MediaSyncArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const dir = args.dir?.trim();
        if (dir === undefined || dir.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--dir is required (a folder of <locale>/<device>/*.png screenshots).",
          });
        }
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* syncMedia(session.ctx, session.appId, platform, {
          rootDir: dir,
          prune: args.prune,
          dryRun: args["dry-run"],
        });
        yield* printHumanTable(
          ["Locale", "Device", "Action", "Local", "Removed"],
          result.actions.map((action) => [
            action.locale,
            action.device,
            action.action,
            String(action.localFiles),
            String(action.removedRemote),
          ]),
        );
        yield* printHuman(
          result.dryRun
            ? `Dry run: ${result.actions.length} set(s) would change. Re-run without --dry-run to apply.`
            : `Synced ${result.actions.length} set(s).`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
