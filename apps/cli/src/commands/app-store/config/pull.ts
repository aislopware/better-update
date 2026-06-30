import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { pullConfig } from "../../../application/app-store-config";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ConfigPullArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly out?: string | undefined;
}

export const configPullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Pull the editable version's per-locale copy into a JSON config document",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    out: { type: "string", description: "Write the JSON document to this file instead of stdout" },
  },
  run: async ({ args }: { readonly args: ConfigPullArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const doc = yield* pullConfig(session.ctx, session.appId, platform);
        const out = args.out?.trim();
        if (out !== undefined && out.length > 0) {
          yield* (yield* FileSystem.FileSystem)
            .writeFileString(out, JSON.stringify(doc, null, 2))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new InvalidArgumentError({
                    message: `Could not write "${out}": ${String(cause)}`,
                  }),
              ),
            );
          yield* printHuman(`Wrote config for ${doc.localizations.length} locale(s) to ${out}.`);
        } else {
          yield* printHuman(JSON.stringify(doc, null, 2));
        }
        return doc;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
