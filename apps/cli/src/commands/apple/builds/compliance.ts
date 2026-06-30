import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { setBuildCompliance } from "../../../application/apple-builds";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface BuildsComplianceArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
  readonly "uses-encryption": boolean;
}

export const buildsComplianceCommand = defineCommand({
  meta: {
    name: "compliance",
    description: "Answer a build's export-compliance question (clears MISSING_EXPORT_COMPLIANCE)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    "uses-encryption": {
      type: "boolean",
      default: false,
      description: "The app uses non-exempt encryption",
      negativeDescription:
        "The app uses only exempt encryption (the common case; clears MISSING_EXPORT_COMPLIANCE)",
    },
  },
  run: async ({ args }: { readonly args: BuildsComplianceArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
