import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

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
      ["Created", build.createdAt],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Show a build"));
