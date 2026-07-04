import { Command } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { pullEnvVars } from "../../lib/env-exporter";
import { getExecTrailingArgv } from "../../lib/exec-trailing-argv";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { overlayProfileEnv, readOptionalProfile } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, parseEnvironmentScopeArg } from "./helpers";

import type { ApiClient } from "../../services/api-client";
import type { EnvironmentName } from "./helpers";

// Best-effort: decrypt + inject the project's env vars, falling back to none on
// any failure (e.g. the vault is locked) so the wrapped command still runs.
const pullForExec = (api: ApiClient, projectId: string, environment: EnvironmentName) =>
  pullEnvVars(api, { projectId, environment }).pipe(
    Effect.orElseSucceed((): Record<string, string> => ({})),
  );

const splitTrailing = (
  trailing: readonly string[] | null,
): Effect.Effect<readonly [string, readonly string[]], InvalidArgumentError> => {
  if (!trailing || trailing.length === 0) {
    return Effect.fail(
      new InvalidArgumentError({
        message:
          "Pass the command after `--`. Example: `better-update env exec production -- bun run dev`.",
      }),
    );
  }
  const [bin, ...rest] = trailing;
  if (bin === undefined) {
    return Effect.fail(new InvalidArgumentError({ message: "Missing command name after `--`." }));
  }
  return Effect.succeed([bin, rest] as const);
};

export const execCommand = defineCommand({
  meta: {
    name: "exec",
    description:
      "Run a command with project env vars injected. Usage: env exec <environment> -- <command...>",
  },
  args: {
    environment: {
      type: "positional",
      required: false,
      description: "Target environment (e.g. production) — optional when --profile is given",
    },
    profile: {
      type: "string",
      description:
        "eas.json build profile: its environment picks the scope and its env block overlays the server vars (profile wins on collision) — same merge as `build`",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const [bin, rest] = yield* splitTrailing(getExecTrailingArgv());
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const profile = yield* readOptionalProfile(projectRoot, args.profile);
        if (args.environment === undefined && profile === undefined) {
          return yield* new InvalidArgumentError({
            message:
              "Pass an environment (`env exec production -- …`) or an eas.json profile (`env exec --profile preview -- …`).",
          });
        }
        const environment = yield* parseEnvironmentScopeArg(args.environment, profile);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const baseEnv = yield* runtime.commandEnvironment();
        const pulled = overlayProfileEnv(yield* pullForExec(api, projectId, environment), profile);

        const cmd = Command.make(bin, ...rest).pipe(
          Command.env({ ...baseEnv, ...pulled }),
          Command.stdin("inherit"),
          Command.stdout("inherit"),
          Command.stderr("inherit"),
        );
        const code = yield* Command.exitCode(cmd).pipe(Effect.orDie);
        yield* runtime.setExitCode(code);
      }),
      { ...envErrorExtras, BuildProfileError: 2 },
    ),
});
