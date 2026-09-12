import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { listBuilds } from "../../../application/apple-builds";
import { printHumanList } from "../../../lib/output";
import { positiveIntFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const buildsListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    limit: positiveIntFlag("limit", { description: "Max builds to return", defaultValue: 50 }),
  },
  Effect.fn(
    function* (args) {
      const { limit } = args;
      const session = yield* openAscSession(args);
      const builds = yield* listBuilds(session.ctx, session.appId, limit);
      yield* printHumanList(
        ["Build", "Version", "Platform", "Processing", "Encryption", "Uploaded", "ID"],
        builds.map((build) => [
          build.version,
          build.appVersion ?? "—",
          build.platform ?? "—",
          build.processingState,
          build.usesNonExemptEncryption ? "non-exempt" : "exempt",
          build.uploadedDate,
          build.id,
        ]),
        "No builds found.",
      );
      return { items: builds };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the app's uploaded App Store Connect builds (newest first)"));
