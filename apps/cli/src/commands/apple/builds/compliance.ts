import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { setBuildCompliance } from "../../../application/apple-builds";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const buildsComplianceCommand = Command.make(
  "compliance",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    "uses-encryption": Flag.Boolean("uses-encryption").pipe(
      Flag.withDescription(
        "The app uses non-exempt encryption (--no-uses-encryption: The app uses only exempt encryption (the common case; clears MISSING_EXPORT_COMPLIANCE))",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const build = yield* resolveBuild(session.ctx, session.appId, {
        buildId: args.build,
        buildVersion: args["build-version"],
      });
      const result = yield* setBuildCompliance(build, args["uses-encryption"]);
      yield* printHuman(
        `Build ${result.version}: export compliance set to ${
          result.usesNonExemptEncryption ? "non-exempt encryption" : "exempt"
        }.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Answer a build's export-compliance question (clears MISSING_EXPORT_COMPLIANCE)",
  ),
);
