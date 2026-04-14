import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { exitWith } from "../../application/command-exit";
import { runUpdatePublish } from "../../application/update-publish";
import { printTable } from "../../lib/output";

const branch = Options.text("branch");
const platform = Options.choice("platform", ["ios", "android", "all"] as const).pipe(
  Options.withDefault("all"),
);
const message = Options.text("message").pipe(Options.optional);
const environment = Options.text("environment").pipe(Options.withDefault("production"));
const clear = Options.boolean("clear");
const manifestBodyFile = Options.text("manifest-body-file").pipe(Options.optional);
const signatureFile = Options.text("signature-file").pipe(Options.optional);
const certificateChainFile = Options.text("certificate-chain-file").pipe(Options.optional);

export const publishCommand = Command.make(
  "publish",
  {
    branch,
    platform,
    message,
    environment,
    clear,
    manifestBodyFile,
    signatureFile,
    certificateChainFile,
  },
  (opts) =>
    Effect.gen(function* () {
      const result = yield* runUpdatePublish({
        branch: opts.branch,
        platform: opts.platform,
        message: Option.getOrUndefined(opts.message),
        environment: opts.environment,
        clear: opts.clear,
        manifestBodyFile: Option.getOrUndefined(opts.manifestBodyFile),
        signatureFile: Option.getOrUndefined(opts.signatureFile),
        certificateChainFile: Option.getOrUndefined(opts.certificateChainFile),
      });

      yield* Console.log(`Published update group ${result.groupId} to branch "${result.branch}".`);
      yield* Console.log("");
      yield* printTable(
        ["Platform", "Update ID", "Runtime Version", "Uploaded", "Reused"],
        result.results.map((entry) => [
          entry.platform,
          entry.updateId,
          entry.runtimeVersion,
          String(entry.uploadedAssets),
          String(entry.deduplicatedAssets),
        ]),
      );
    }).pipe(
      Effect.catchTags({
        AuthRequiredError: (error) => exitWith(3, error.message),
        ProjectNotLinkedError: (error) => exitWith(4, error.message),
        BuildProfileError: (error) => exitWith(2, error.message),
        RuntimeVersionError: (error) => exitWith(2, error.message),
        EnvExportError: (error) => exitWith(7, error.message),
        BuildFailedError: (error) => exitWith(6, error.message),
        UpdatePublishError: (error) => exitWith(7, error.message),
      }),
    ),
);
