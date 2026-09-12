import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { listBundleIds } from "../../../application/apple-signing-inventory";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const bundleIdListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const bundleIds = yield* listBundleIds(session.ctx);
      yield* printHumanList(
        ["Identifier", "Name", "Platform", "Seed", "ID"],
        bundleIds.map((bundleId) => [
          bundleId.identifier,
          bundleId.name,
          bundleId.platform,
          bundleId.seedId,
          bundleId.id,
        ]),
        "No App IDs found.",
      );
      return { items: bundleIds };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List the team's registered App IDs (bundle ids) on App Store Connect (CI-safe)",
  ),
);
