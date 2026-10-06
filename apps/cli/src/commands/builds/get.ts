import { readMacosBuildMetadata } from "@better-update/api";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";

import type { MacosNotarization } from "@better-update/api";

import { printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

const notarizationLabel = (notarization: MacosNotarization | undefined): string => {
  if (notarization === undefined) {
    return "-";
  }
  if (notarization.status === "accepted") {
    return notarization.stapled ? "accepted (stapled)" : "accepted";
  }
  return notarization.status === "pending"
    ? `pending with Apple (submission ${notarization.submissionId ?? "unknown"})`
    : "skipped";
};

/** Developer ID facts a macOS build records; nothing for other platforms. */
const macosRows = (metadataJson: string): readonly (readonly [string, string])[] => {
  const macos = readMacosBuildMetadata(metadataJson);
  return macos === undefined
    ? []
    : [
        ["Notarization", notarizationLabel(macos.notarization)],
        ["Minimum macOS", macos.minimumSystemVersion ?? "-"],
        ["Architectures", macos.architectures?.join(", ") ?? "-"],
        ["Team ID", macos.teamId ?? "-"],
      ];
};

export const getCommand = Command.make(
  "get",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Build ID")),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const build = yield* api.builds.get({ params: { id: args.id } });
    yield* printKeyValue([
      ["ID", build.id],
      ["Platform", build.platform],
      ["Profile", build.profile],
      ["Distribution", build.distribution],
      ["Version", build.appVersion ?? "-"],
      ["Build Number", build.buildNumber ?? "-"],
      ["Runtime Version", build.runtimeVersion ?? "-"],
      ["Bundle ID", build.bundleId ?? "-"],
      ["Git Ref", build.gitRef ?? "-"],
      ["Message", build.message ?? "-"],
      [
        "Artifact",
        build.artifact
          ? `${build.artifact.format} (${String(build.artifact.byteSize)} bytes)`
          : "none",
      ],
      ...macosRows(build.metadataJson),
      ["Created", build.createdAt],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Show a build"));
