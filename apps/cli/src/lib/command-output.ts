import { Context, Effect, Layer, Option, Stdio } from "effect";

import type { Command } from "effect/unstable/cli";

import { globalFlagAt } from "./global-flags";

/**
 * The dotted command path (e.g. `devices.list`) stamped on every JSON envelope.
 * Resolved once per process by {@link CommandNameLayer} from the CLI's argv +
 * command tree, so the three envelope sites (output.ts success, run-command.ts
 * return-value, command-exit.ts error) share one value without reading argv.
 */
export class CommandName extends Context.Service<CommandName, string>()("cli/CommandName") {}

/**
 * The resolved command name, or `"unknown"` outside a CLI run (unit tests that
 * exercise the output helpers without booting the root command). Optional so
 * the output port stays `OutputMode`-only in its requirements.
 */
export const activeCommandName: Effect.Effect<string> = Effect.map(
  Effect.serviceOption(CommandName),
  Option.getOrElse(() => "unknown"),
);

/**
 * A tree of valid command-path prefixes for {@link resolveCommandName}. Built
 * from the root command by {@link buildKnownCommandTree} so the resolver can
 * stop at the deepest REGISTERED subcommand and never fold a trailing
 * positional (an ID) into the command path.
 */
export interface KnownCommandTree {
  readonly [name: string]: KnownCommandTree;
}

/** Walk a command's subcommand groups into a plain name → children tree. */
export const buildKnownCommandTree = (command: Command.Command.Any): KnownCommandTree =>
  Object.fromEntries(
    command.subcommands
      .flatMap((group) => group.commands)
      .map((child) => [child.name, buildKnownCommandTree(child)] as const),
  );

const isFlag = (token: string): boolean => token.startsWith("-");

/**
 * Derive the dotted command path from the CLI arguments (argv without the
 * node + script prefix). The walk follows tokens ONLY while they descend into
 * a registered subcommand and stops at the first token that is not a child of
 * the current node — so `branches view bch_123` resolves to `branches.view`,
 * never leaking the id into the envelope `command` field. Global flags (and
 * their values) are skipped wherever they appear; any other flag ends the
 * walk. Falls back to `"unknown"` when there is no command token (bare
 * `better-update`).
 */
export const resolveCommandName = (
  args: readonly string[],
  knownCommands: KnownCommandTree,
): string => {
  const segments: string[] = [];
  let node = knownCommands;
  let index = 0;
  while (index < args.length) {
    const global = globalFlagAt(args, index);
    if (global === undefined) {
      const token = args[index];
      const next = token === undefined || isFlag(token) ? undefined : node[token];
      if (token === undefined || next === undefined) {
        break;
      }
      segments.push(token);
      node = next;
      index += 1;
    } else {
      index += global.span;
    }
  }
  return segments.length === 0 ? "unknown" : segments.join(".");
};

/** Provide {@link CommandName} for a run of `root`, resolved from the `Stdio` arguments. */
export const makeCommandNameLayer = (
  root: Command.Command.Any,
): Layer.Layer<CommandName, never, Stdio.Stdio> =>
  Layer.effect(
    CommandName,
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      const args = yield* stdio.args;
      return resolveCommandName(args, buildKnownCommandTree(root));
    }),
  );
