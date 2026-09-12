import { Effect, Stdio } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

import { runExitCode } from "../../lib/child-process";
import { pullEnvVars } from "../../lib/env-exporter";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { optionalArgument, optionalFlag } from "../../lib/params";
import { overlayProfileEnv, readOptionalProfile } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { parseEnvironmentScopeArg } from "./helpers";

import type { ApiClient } from "../../services/api-client";
import type { EnvironmentName } from "./helpers";

// Best-effort: decrypt + inject the project's env vars, falling back to none on
// any failure (e.g. the vault is locked) so the wrapped command still runs.
const pullForExec = (api: ApiClient, projectId: string, environment: EnvironmentName) =>
  pullEnvVars(api, { projectId, environment }).pipe(
    Effect.orElseSucceed((): Record<string, string> => ({})),
  );

/**
 * Recover `<environment>` vs `<command...>` from the parsed positionals. The
 * parser folds the operands after `--` into `command`, so an `env exec
 * --profile preview -- bun run dev` call has no environment: the operand count
 * after `--` (from the raw arguments) tells the two apart.
 */
const splitOperands = (
  positionals: readonly string[],
  trailingCount: number,
): Effect.Effect<
  {
    readonly environment: string | undefined;
    readonly bin: string;
    readonly rest: readonly string[];
  },
  InvalidArgumentError
> => {
  if (trailingCount === 0) {
    return Effect.fail(
      new InvalidArgumentError({
        message:
          "Pass the command after `--`. Example: `better-update env exec production -- bun run dev`.",
      }),
    );
  }
  const environment = positionals.length > trailingCount ? positionals[0] : undefined;
  const [bin, ...rest] = positionals.slice(positionals.length - trailingCount);
  if (bin === undefined) {
    return Effect.fail(new InvalidArgumentError({ message: "Missing command name after `--`." }));
  }
  return Effect.succeed({ environment, bin, rest });
};

export const execCommand = Command.make(
  "exec",
  {
    environment: Argument.String("environment").pipe(
      Argument.withDescription(
        "Target environment (e.g. production) — optional when --profile is given",
      ),
      optionalArgument,
    ),
    command: Argument.String("command").pipe(
      Argument.withDescription("Command (and its arguments) to run, after `--`"),
      Argument.variadic(),
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription(
        "eas.json build profile: its environment picks the scope and its env block overlays the server vars (profile wins on collision) — same merge as `build`",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const stdio = yield* Stdio.Stdio;
    const rawArgs = yield* stdio.args;
    const separator = rawArgs.indexOf("--");
    const trailingCount = separator === -1 ? 0 : rawArgs.length - separator - 1;
    const {
      environment: environmentArg,
      bin,
      rest,
    } = yield* splitOperands(
      [...(args.environment === undefined ? [] : [args.environment]), ...args.command],
      trailingCount,
    );
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const profile = yield* readOptionalProfile(projectRoot, args.profile);
    if (environmentArg === undefined && profile === undefined) {
      return yield* new InvalidArgumentError({
        message:
          "Pass an environment (`env exec production -- …`) or an eas.json profile (`env exec --profile preview -- …`).",
      });
    }
    const environment = yield* parseEnvironmentScopeArg(environmentArg, profile);
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const baseEnv = yield* runtime.commandEnvironment();
    const pulled = overlayProfileEnv(yield* pullForExec(api, projectId, environment), profile);

    // Stdio has to be configured at construction time in v4 — the child
    // takes over this terminal, so all three streams are inherited.
    const cmd = ChildProcess.make(bin, rest, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).pipe(ChildProcess.setEnv({ ...baseEnv, ...pulled }));
    const code = yield* runExitCode(cmd).pipe(Effect.orDie);
    yield* runtime.setExitCode(code);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Run a command with project env vars injected. Usage: env exec <environment> -- <command...>",
  ),
);
