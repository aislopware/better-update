import path from "node:path";

import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

export const downloadCommand = Command.make(
  "download",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Build ID")),
    output: Flag.String("output").pipe(
      Flag.withDescription("Output path (default: ./<id>.<ext> inferred from artifact format)"),
      optionalFlag,
    ),
    apk: Flag.Boolean("apk").pipe(
      Flag.withDescription(
        "For an .aab build, download the attached universal APK (device-installable) instead of the bundle",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const cwd = yield* runtime.cwd;

    const build = yield* api.builds.get({ params: { id: args.id } });
    const { artifact } = build;
    if (!artifact) {
      return yield* new UploadFailedError({
        message: `Build ${args.id} has no artifact yet.`,
      });
    }

    const link = yield* api.builds.getInstallLink({ params: { id: args.id } });
    const wantsApk = args.apk;
    if (wantsApk && (artifact.format !== "aab" || !build.installArtifact || !link.installUrl)) {
      return yield* new UploadFailedError({
        message:
          artifact.format === "aab"
            ? `Build ${args.id} has no universal APK attached. Rebuild with the current CLI to get one.`
            : `--apk only applies to .aab builds; build ${args.id} is ${artifact.format}.`,
      });
    }
    const ext = wantsApk ? "universal.apk" : artifact.format;
    const outputPath = args.output ?? path.join(cwd, `${args.id}.${ext}`);

    const bytes = yield* fetchBytes(
      wantsApk ? (link.installUrl ?? link.artifactUrl) : link.artifactUrl,
      "artifact",
    );
    yield* fs.writeFile(outputPath, bytes);

    yield* printKeyValue([
      ["Path", outputPath],
      ["Format", ext],
      ["Size", `${String(bytes.byteLength)} bytes`],
    ]);
  }, runCommand()),
).pipe(
  Command.withDescription("Download the artifact for a build (.ipa/.apk/.aab) to a local path"),
);
