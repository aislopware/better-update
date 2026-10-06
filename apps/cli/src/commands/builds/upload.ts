import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { runDesktopUploadWorkflow } from "../../application/desktop-upload";
import { runUploadWorkflow } from "../../application/upload-workflow";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const uploadCommand = Command.make(
  "upload",
  {
    "artifact-path": Argument.String("artifact-path").pipe(
      Argument.withDescription(
        "Path to the artifact; for windows / linux, every installer or package to upload, each its own build",
      ),
      Argument.variadic(),
    ),
    platform: Flag.Literals("platform", ["ios", "android", "windows", "linux"]).pipe(
      Flag.withDescription(
        "ios (.ipa), android (.apk/.aab), windows (.exe/.msi) or linux (.AppImage/.deb/.rpm)",
      ),
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription("Build profile name"),
      Flag.withDefault("production"),
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Optional build message"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const paths = args["artifact-path"];
    const [first] = paths;
    if (first === undefined) {
      return yield* new InvalidArgumentError({ message: "Pass the artifact to upload." });
    }
    if (args.platform === "windows" || args.platform === "linux") {
      yield* runDesktopUploadWorkflow({
        platform: args.platform,
        profileName: args.profile,
        artifactPaths: paths,
        message: args.message,
      });
      return;
    }
    if (paths.length > 1) {
      return yield* new InvalidArgumentError({
        message: `An ${args.platform} upload takes one artifact; ${String(paths.length)} were given.`,
      });
    }
    yield* runUploadWorkflow({
      artifactPath: first,
      platform: args.platform,
      profileName: args.profile,
      message: args.message,
    });
  }, runCommand()),
).pipe(Command.withDescription("Upload an existing artifact to better-update"));
