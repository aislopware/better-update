import { defineCommand } from "citty";
import { Effect } from "effect";

import { pushConfig } from "../../../application/app-store-config";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { readJsonInput } from "../../../lib/json-input";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ConfigPushArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly from?: string | undefined;
}

export const configPushCommand = defineCommand({
  meta: {
    name: "push",
    description: "Apply a JSON config document's per-locale copy to the editable version",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    from: {
      type: "string",
      description: "Config JSON file or inline JSON (from `config pull`) (required)",
    },
  },
  run: async ({ args }: { readonly args: ConfigPushArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const from = args.from?.trim();
        if (from === undefined || from.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--from is required (a config JSON file or inline JSON from `config pull`).",
          });
        }
        const document = yield* readJsonInput(from);
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* pushConfig(session.ctx, session.appId, platform, document);
        yield* printHuman(
          `Applied copy to ${result.applied} locale(s)${
            result.skipped.length > 0 ? `, skipped ${result.skipped.length} with no copy` : ""
          }.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
