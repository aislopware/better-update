import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBuildsCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const getCommand = Command.make("get", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const build = yield* api.builds.get({ path: { id: opts.id } });
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
  }).pipe(handleBuildsCommandErrors),
);
