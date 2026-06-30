import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { setBuildWhatsNew } from "../../../application/testflight-builds";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface BuildWhatsNewArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
  readonly locale?: string | undefined;
  readonly "whats-new"?: string | undefined;
  readonly "text-file"?: string | undefined;
}

export const buildWhatsNewCommand = defineCommand({
  meta: {
    name: "whats-new",
    description: "Set a build's 'What to Test' notes for a locale (editable after upload)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    locale: { type: "string", default: "en-US", description: "Locale to set (default: en-US)" },
    "whats-new": { type: "string", description: "The 'What to Test' notes" },
    "text-file": {
      type: "string",
      description: "Read the notes from a file instead of --whats-new",
    },
  },
  run: async ({ args }: { readonly args: BuildWhatsNewArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const fromFile = args["text-file"];
        const inline = args["whats-new"];
        const text = yield* Effect.gen(function* () {
          if (fromFile !== undefined) {
            return yield* (yield* FileSystem.FileSystem).readFileString(fromFile).pipe(
              Effect.mapError(
                (cause) =>
                  new InvalidArgumentError({
                    message: `Could not read --text-file "${fromFile}": ${String(cause)}`,
                  }),
              ),
            );
          }
          if (inline !== undefined) {
            return inline;
          }
          return yield* new InvalidArgumentError({ message: "Pass --whats-new or --text-file." });
        });
        const locale = args.locale ?? "en-US";
        const session = yield* openAscSession(args);
        const build = yield* resolveBuild(session.ctx, session.appId, {
          buildId: args.build,
          buildVersion: args["build-version"],
        });
        const result = yield* setBuildWhatsNew(session.ctx, build, locale, text);
        yield* printHuman(
          `Set ${result.locale} 'What to Test' on build ${build.attributes.version}.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
