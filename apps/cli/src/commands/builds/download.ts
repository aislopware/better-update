import path from "node:path";

import { defineCommand } from "citty";
import { FileSystem, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const EXIT_EXTRAS = { UploadFailedError: 7 } as const;

export const downloadCommand = defineCommand({
  meta: {
    name: "download",
    description: "Download the artifact for a build (.ipa/.apk/.aab) to a local path",
  },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
    output: {
      type: "string",
      description: "Output path (default: ./<id>.<ext> inferred from artifact format)",
    },
    apk: {
      type: "boolean",
      description:
        "For an .aab build, download the attached universal APK (device-installable) instead of the bundle",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
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
        const wantsApk = args.apk === true;
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
      }),
      EXIT_EXTRAS,
    ),
});
