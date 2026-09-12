import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { syncMedia } from "../../../application/app-store-media";
import { printHuman, printHumanTable } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const mediaSyncCommand = Command.make(
  "sync",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    dir: Flag.String("dir").pipe(
      Flag.withDescription("Root directory holding <locale>/<device>/*.png"),
    ),
    prune: Flag.Boolean("prune").pipe(
      Flag.withDescription(
        "Also empty remote device sets a present locale does not declare locally",
      ),
      Flag.withDefault(false),
    ),
    "dry-run": Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print the plan without uploading or deleting anything"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const dir = args.dir.trim();
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Sync a screenshots/<locale>/<device>/*.png tree to the editable version (each local set replaces its remote)",
  ),
);
