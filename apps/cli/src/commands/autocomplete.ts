import { Console as NodeConsole } from "node:console";
import { Writable } from "node:stream";

import { Console, Effect, Option } from "effect";
import { Argument, Command, GlobalFlag } from "effect/unstable/cli";

import { CliRoot } from "../lib/cli-root";
import { CLI_BUILT_INS } from "../lib/global-flags";
import { printHuman } from "../lib/output";
import { runCommand } from "../lib/run-command";

type Shell = "bash" | "zsh" | "fish";

/**
 * Render the same script the built-in `--completions <shell>` flag prints.
 * The built-in only knows how to write it to the console, so it runs against a
 * capturing console and the text comes back as a value — the JSON envelope
 * carries it like any other command result.
 */
const renderCompletionScript = (shell: Shell): Effect.Effect<string, never, CliRoot> =>
  Effect.gen(function* () {
    const root = yield* CliRoot;
    const chunks: string[] = [];
    const sink = new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        chunks.push(chunk.toString());
        callback();
      },
    });
    yield* GlobalFlag.Completions.run(Option.some(shell), {
      command: root.command,
      commandPath: [root.command.name],
      version: root.version,
      builtIns: CLI_BUILT_INS,
    }).pipe(
      Effect.provideService(Console.Console, new NodeConsole({ stdout: sink, stderr: sink })),
    );
    return chunks.join("").replace(/\n$/u, "");
  });

export const autocompleteCommand = Command.make(
  "autocomplete",
  {
    shell: Argument.Literals("shell", ["bash", "zsh", "fish"]).pipe(
      Argument.withDescription("Shell to generate the completion script for"),
    ),
  },
  Effect.fn(
    function* ({ shell }) {
      const script = yield* renderCompletionScript(shell);
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
