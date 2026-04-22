import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const installLinkCommand = defineCommand({
  meta: { name: "install-link", description: "Get install/artifact URLs for a build" },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.builds.getInstallLink({ path: { id: args.id } });
        yield* printKeyValue([
          ["Artifact URL", result.artifactUrl],
          ["Install URL", result.installUrl ?? "-"],
          ["Expires", String(result.expires)],
        ]);
      }),
    ),
});
