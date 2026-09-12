import { Context } from "effect";

import type { Command } from "effect/unstable/cli";

/**
 * The composed root command + CLI version, for commands that introspect the
 * tree at runtime (`autocomplete` renders completion scripts from it). Provided
 * once by the entrypoint via `Command.provide`.
 */
export class CliRoot extends Context.Service<
  CliRoot,
  {
    readonly command: Command.Command.Any;
    readonly version: string;
  }
>()("cli/CliRoot") {}
