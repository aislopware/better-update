import { Effect } from "effect";
import { Argument, Command, Completions } from "effect/cli";

import { CliRoot } from "../lib/cli-root";
import { printHuman } from "../lib/output";
import { runCommand } from "../lib/run-command";

export const autocompleteCommand = Command.make(
  "autocomplete",
  {
    shell: Argument.Literals("shell", ["bash", "zsh", "fish"]).pipe(
      Argument.withDescription("Shell to generate the completion script for"),
    ),
  },
  Effect.fn(
    function* ({ shell }) {
      // The same script the built-in `--completions <shell>` flag prints, as a
      // value, so the JSON envelope carries it like any other command result.
      const { command } = yield* CliRoot;
      const script = Completions.generate(command.name, shell, Completions.fromCommand(command));
      yield* printHuman(script);
      return { shell, script };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Print a shell completion script. Source it (or pipe to your rc file) to enable Tab-completion.",
  ),
);
