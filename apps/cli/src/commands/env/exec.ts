import { Command } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { pullEnvVars } from "../../lib/env-exporter";
import { getExecTrailingArgv } from "../../lib/exec-trailing-argv";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

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
      required: true,
      description: "Target environment (e.g. production)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const [bin, rest] = yield* splitTrailing(getExecTrailingArgv());
        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const baseEnv = yield* runtime.commandEnvironment();
        const pulled = yield* pullForExec(api, projectId, environment);

        const cmd = Command.make(bin, ...rest).pipe(
          Command.env({ ...baseEnv, ...pulled }),
          Command.stdin("inherit"),
          Command.stdout("inherit"),
          Command.stderr("inherit"),
        );
        const code = yield* Command.exitCode(cmd).pipe(Effect.orDie);
        yield* runtime.setExitCode(code);
      }),
      envErrorExtras,
    ),
});
