import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const getCommand = defineCommand({
  meta: { name: "get", description: "Show a build" },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const build = yield* api.builds.get({ path: { id: args.id } });
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
      }),
    ),
});
