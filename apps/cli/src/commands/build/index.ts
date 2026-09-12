import { compact } from "@better-update/type-guards";
import { Command, Flag } from "effect/unstable/cli";

import { runBuildWorkflow } from "../../application/build-workflow";
import { runBuildWorkflowAll } from "../../application/build-workflow-all";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { configureBuildCommand } from "./configure";

export const buildCommand = Command.make(
  "build",
  {
    platform: Flag.Literals("platform", ["ios", "android", "all"]).pipe(
      Flag.withDescription(
        'Target platform; "all" builds ios and android in parallel (auto-detected from app.json when omitted)',
      ),
      optionalFlag,
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Build profile name"),
      Flag.withDefault("production"),
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Optional build message"),
      optionalFlag,
    ),
    upload: Flag.Boolean("upload").pipe(
      Flag.withDescription(
        "Upload the built artifact to better-update (--no-upload: Skip upload (use --no-upload))",
      ),
      Flag.withDefault(true),
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("Copy the built artifact to this path after completing the build"),
      optionalFlag,
    ),
    "raw-output": Flag.Boolean("raw-output").pipe(
      Flag.withDescription("Stream raw Gradle/Xcode output"),
      Flag.withDefault(false),
    ),
    "clear-cache": Flag.Boolean("clear-cache").pipe(
      Flag.withDescription("Clear project-scoped build caches before building"),
      Flag.withDefault(false),
    ),
    "freeze-credentials": Flag.Boolean("freeze-credentials").pipe(
      Flag.withDescription("Fail fast if credentials missing instead of prompting (for CI)"),
      Flag.withDefault(false),
    ),
    "allow-dirty": Flag.Boolean("allow-dirty").pipe(
      Flag.withDescription("Proceed even with uncommitted git changes"),
      Flag.withDefault(false),
    ),
    "auto-submit": Flag.Boolean("auto-submit").pipe(
      Flag.withDescription(
        "After upload, submit the build using eas.json submit profile of the same name",
      ),
      Flag.withAlias("s"),
      Flag.withDefault(false),
    ),
    "auto-submit-with-profile": Flag.String("auto-submit-with-profile").pipe(
      Flag.withDescription("After upload, submit the build using a specific submit profile"),
      optionalFlag,
    ),
    "what-to-test": Flag.String("what-to-test").pipe(
      Flag.withDescription("iOS-only TestFlight changelog when auto-submitting"),
      optionalFlag,
    ),
  },
  (args) => {
    const options = {
      profileName: args.profile,
      message: args.message,
      noUpload: !args.upload,
      rawOutput: args["raw-output"],
      clearCache: args["clear-cache"],
      freezeCredentials: args["freeze-credentials"],
      allowDirty: args["allow-dirty"],
      ...compact({
        output: args.output,
        autoSubmit: args["auto-submit-with-profile"] === undefined ? args["auto-submit"] : true,
        autoSubmitProfile: args["auto-submit-with-profile"],
        whatToTest: args["what-to-test"],
      }),
    };
    return args.platform === "all"
      ? runBuildWorkflowAll(options).pipe(runCommand())
      : runBuildWorkflow({ ...options, platform: args.platform }).pipe(runCommand());
  },
).pipe(
  Command.withDescription("Build the app locally and optionally upload"),
  Command.withSubcommands([configureBuildCommand]),
);
