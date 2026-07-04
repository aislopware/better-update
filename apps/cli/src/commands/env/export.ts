import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { overlayProfileEnvItems, readOptionalProfile } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, parseEnvironmentScopeArg } from "./helpers";

export const exportCommand = defineCommand({
  meta: { name: "export", description: "Print env vars in KEY='value' format" },
  args: {
    environment: {
      type: "string",
      description:
        "Target environment (development, preview, production; defaults to --profile's environment, else production)",
    },
    profile: {
      type: "string",
      description:
        "eas.json build profile: its environment picks the scope and its env block overlays the exported set (profile wins on collision) — same merge as `build`",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const profile = yield* readOptionalProfile(projectRoot, args.profile);
        const environment = yield* parseEnvironmentScopeArg(args.environment, profile);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const items = overlayProfileEnvItems(
          yield* exportDecryptedEnvVars(api, projectId, environment),
          profile,
        );

        for (const item of items) {
          const escaped = item.value.replaceAll("'", String.raw`'\''`);
          yield* printHuman(`${item.key}='${escaped}'`);
        }
        return { environment, items };
      }),
      { exits: { ...envErrorExtras, BuildProfileError: 2 }, json: "value" },
    ),
});
