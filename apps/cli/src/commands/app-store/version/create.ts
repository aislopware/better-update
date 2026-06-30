import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { ensureVersion } from "../../../application/app-store-versions";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface VersionCreateArgs extends AscCommonArgs {
  readonly version?: string | undefined;
  readonly platform?: string | undefined;
}

export const versionCreateCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create (or rename) the editable App Store version for a version string",
  },
  args: {
    ...ASC_COMMON_ARGS,
    version: {
      type: "string",
      description: "Marketing version string to create, e.g. 1.2.0 (required)",
    },
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: VersionCreateArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.version === undefined || args.version.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--version is required." });
        }
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const version = yield* ensureVersion(
          session.ctx,
          session.appId,
          args.version.trim(),
          platform,
        );
        yield* printHuman(
          `App Store version ${version.versionString} is ready (${version.state}).`,
        );
        yield* printHumanKeyValue([
          ["Version", version.versionString],
          ["Platform", version.platform],
          ["State", version.state],
          ["ID", version.id],
        ]);
        return version;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
