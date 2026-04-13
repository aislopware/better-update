import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";

import { BuildFailedError } from "../../lib/exit-codes";

export const runStep = (
  cmd: Command.Command,
  step: string,
): Effect.Effect<void, BuildFailedError, CommandExecutor.CommandExecutor> =>
  Command.exitCode(cmd.pipe(Command.stdout("inherit"), Command.stderr("inherit"))).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step,
          exitCode: 1,
          message: `${step} failed to spawn: ${String(cause)}`,
        }),
    ),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new BuildFailedError({
              step,
              exitCode: code,
              message: `${step} exited with code ${code}`,
            }),
          ),
    ),
  );
