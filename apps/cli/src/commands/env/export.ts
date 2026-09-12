import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { overlayProfileEnvItems, readOptionalProfile } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { parseEnvironmentScopeArg } from "./helpers";

export const exportCommand = Command.make(
  "export",
  {
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        "Target environment (development, preview, production; defaults to --profile's environment, else production)",
      ),
      optionalFlag,
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription(
        "eas.json build profile: its environment picks the scope and its env block overlays the exported set (profile wins on collision) — same merge as `build`",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Print env vars in KEY='value' format"));
