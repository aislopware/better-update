import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { runEmbeddedUpload } from "../../application/embedded-upload";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const embeddedUploadCommand = Command.make(
  "embedded:upload",
  {
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription("Platform the embedded bundle was built for"),
    ),
    bundle: Flag.String("bundle").pipe(
      Flag.withDescription("Path to the embedded launch bundle extracted from the native build"),
    ),
    "embedded-id": Flag.String("embedded-id").pipe(
      Flag.withDescription(
        "The lowercase UUID from the native build app.manifest (id field). iOS: <App>.app/EXUpdates.bundle/app.manifest; Android: assets/app.manifest inside the APK/AAB. This is the value the device reports as expo-embedded-update-id.",
      ),
    ),
    branch: Flag.String("branch").pipe(Flag.withDescription("Target branch name"), optionalFlag),
    channel: Flag.String("channel").pipe(
      Flag.withDescription("Channel name to route the update through (resolves to branch)"),
      optionalFlag,
    ),
    "runtime-version": Flag.String("runtime-version").pipe(
      Flag.withDescription("Runtime version (defaults to resolving from app config)"),
      optionalFlag,
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Optional update message"),
      optionalFlag,
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Env vars scope"),
      Flag.withDefault("production"),
    ),
    auto: Flag.Boolean("auto").pipe(
      Flag.withDescription(
        "Skip prompts (for CI); infer the branch from the current git branch and the message from the latest commit subject",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const result = yield* runEmbeddedUpload({
        platform: args.platform,
        bundlePath: args.bundle,
        embeddedId: args["embedded-id"],
        branch: args.branch,
        channel: args.channel,
        runtimeVersion: args["runtime-version"],
        message: args.message,
        environment: args.environment,
        auto: args.auto,
      });

      yield* printHuman(
        `Registered embedded baseline under id ${result.updateId} (== the supplied --embedded-id) for ${result.platform} on branch "${result.branch}" (runtime ${result.runtimeVersion}).`,
      );
      yield* printHuman(
        result.reused
          ? "Launch bundle already present in storage — reused existing bytes."
          : "Uploaded embedded launch bundle bytes.",
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Register the native build's embedded launch bundle as a (currently-dormant) patch baseline, pinned to the binary's app.manifest UUID (isEmbedded update)",
  ),
);
