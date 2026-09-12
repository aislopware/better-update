import { FileSystem, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { setBuildWhatsNew } from "../../../application/testflight-builds";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";
import { validateWhatsNew } from "../../../lib/whats-new";

export const buildWhatsNewCommand = Command.make(
  "whats-new",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    latest: Flag.Boolean("latest").pipe(
      Flag.withDescription(
        "Target the most recently uploaded build (ignored if --build/--build-version given)",
      ),
      Flag.withDefault(false),
    ),
    locale: Flag.String("locale").pipe(
      Flag.withDescription("Locale to set (default: en-US)"),
      Flag.withDefault("en-US"),
    ),
    "whats-new": Flag.String("whats-new").pipe(
      Flag.withDescription("The 'What to Test' notes"),
      optionalFlag,
    ),
    "text-file": Flag.String("text-file").pipe(
      Flag.withDescription("Read the notes from a file instead of --whats-new"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
      const invalid = validateWhatsNew(text);
      if (invalid !== null) {
        return yield* new InvalidArgumentError({ message: invalid.message });
      }
      const { locale } = args;
      const session = yield* openAscSession(args);
      const build = yield* resolveBuild(session.ctx, session.appId, {
        buildId: args.build,
        buildVersion: args["build-version"],
        latest: args.latest,
      });
      const result = yield* setBuildWhatsNew(session.ctx, build, locale, text);
      yield* printHuman(
        `Set ${result.locale} 'What to Test' on build ${build.attributes.version}.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set a build's 'What to Test' notes for a locale (editable after upload)",
  ),
);
