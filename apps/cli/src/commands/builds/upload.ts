import { Argument, Command, Flag } from "effect/unstable/cli";

import { runUploadWorkflow } from "../../application/upload-workflow";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const uploadCommand = Command.make(
  "upload",
  {
    "artifact-path": Argument.String("artifact-path").pipe(
      Argument.withDescription("Path to artifact"),
    ),
    platform: Flag.Literals("platform", ["ios", "android"]),
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Build profile name"),
      Flag.withDefault("production"),
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Optional build message"),
      optionalFlag,
    ),
  },
  (args) =>
    runUploadWorkflow({
      artifactPath: args["artifact-path"],
      platform: args.platform,
      profileName: args.profile,
      message: args.message,
    }).pipe(runCommand()),
).pipe(Command.withDescription("Upload an existing artifact to better-update"));
