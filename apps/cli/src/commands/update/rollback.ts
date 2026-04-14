import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { runUpdateRollback } from "../../application/update-rollback";
import { printTable } from "../../lib/output";
import { handleUpdateCommandErrors } from "./helpers";

const branch = Options.text("branch");
const platform = Options.choice("platform", ["ios", "android", "all"] as const).pipe(
  Options.withDefault("all"),
);
const message = Options.text("message").pipe(Options.optional);
const commitTime = Options.text("commit-time").pipe(Options.optional);

export const rollbackCommand = Command.make(
  "rollback",
  { branch, platform, message, commitTime },
  (opts) =>
    Effect.gen(function* () {
      const result = yield* runUpdateRollback({
        branch: opts.branch,
        platform: opts.platform,
        message: Option.getOrUndefined(opts.message),
        commitTime: Option.getOrUndefined(opts.commitTime),
      });

      yield* Console.log(
        `Created rollback group ${result.groupId} on branch "${result.branch}" at ${result.commitTime}.`,
      );
      yield* Console.log("");
      yield* printTable(
        ["Platform", "Update ID", "Runtime Version"],
        result.results.map((entry) => [entry.platform, entry.updateId, entry.runtimeVersion]),
      );
    }).pipe(handleUpdateCommandErrors),
);
