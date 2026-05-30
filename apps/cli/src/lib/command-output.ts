/**
 * Pure helpers for the CLI output port.
 *
 * The output port is "by construction": commands never decide HOW to render
 * JSON. They emit human chrome as side effects (suppressed in `--json` via the
 * OutputMode-aware `output.ts` helpers) and the single success-serialization
 * site (citty-effect.ts) / error-serialization site (command-exit.ts) wraps the
 * machine payload in a schema-versioned envelope.
 *
 * This module stays a pure leaf (no I/O, no repositories, no cloudflare): it
 * only derives the dotted command path for the envelope from a citty-rewritten
 * argv. The boundary modules read OutputMode + perform the stdout write.
 */

/** Default node argv prefix length: argv[0]=node, argv[1]=script, command at [2+]. */
const ARGV_COMMAND_OFFSET = 2;

const isFlag = (token: string): boolean => token.startsWith("-");

/**
 * A tree of valid command-path prefixes for {@link resolveCommandName}. Built
 * from the registry by {@link buildKnownCommandTree} so the resolver can stop at
 * the deepest REGISTERED subcommand and never fold a trailing positional (an ID)
 * into the command path. Each node maps a subcommand name to its children.
 */
export interface KnownCommandTree {
  readonly [name: string]: KnownCommandTree;
}

/** Narrow an unknown value to its `subCommands` object without trusting citty's generics. */
const readSubCommands = (command: unknown): object | undefined => {
  if (typeof command !== "object" || command === null || !("subCommands" in command)) {
    return undefined;
  }
  const { subCommands } = command;
  return typeof subCommands === "object" && subCommands !== null ? subCommands : undefined;
};

/**
 * Walk a citty-style registry (`{ [name]: { subCommands?: {...} } }`) into a
 * plain {@link KnownCommandTree} of subcommand names. Pure: reads only the
 * `subCommands` shape, never the `run` bodies, so it boots nothing. Accepts a
 * bare `object` so it does not depend on citty's `CommandDef` generics —
 * `Object.entries` yields `[string, unknown]` pairs we narrow per node.
 */
export const buildKnownCommandTree = (registry: object): KnownCommandTree => {
  const tree: Record<string, KnownCommandTree> = {};
  for (const [name, command] of Object.entries(registry)) {
    const subCommands = readSubCommands(command);
    tree[name] = subCommands ? buildKnownCommandTree(subCommands) : {};
  }
  return tree;
};

// The active command tree, set ONCE by index.ts after it imports the registry
// (mirrors setActiveCliLayer). Module-level state here — rather than importing
// the registry from this leaf — keeps command-output.ts cycle-free: the registry
// imports command modules, which import the runEffect boundary, which reads
// resolveCommandName from here.
let knownCommandTree: KnownCommandTree | undefined = undefined;

export const setKnownCommandTree = (tree: KnownCommandTree): void => {
  knownCommandTree = tree;
};

/**
 * Resolve the envelope command path from `process.argv` using the registry tree
 * set by {@link setKnownCommandTree} (so trailing positionals/ids are dropped).
 * The single resolver the three boundary sites (output.ts success envelope,
 * citty-effect.ts return-value envelope, command-exit.ts error envelope) call —
 * they all key off the same tree without importing the registry.
 */
export const resolveActiveCommandName = (argv: readonly string[]): string =>
  knownCommandTree === undefined
    ? resolveCommandName(argv)
    : resolveCommandName(argv, { knownCommands: knownCommandTree });

/**
 * Derive the dotted command path (e.g. `devices.list`) from the citty-rewritten
 * argv. The entrypoint (index.ts) rewrites `process.argv` to
 * `[node, script, ...subcommandPath, ...args]` after stripping global flags, so
 * the leading non-flag tokens are the subcommand chain.
 *
 * When `knownCommands` is supplied (the registry-derived tree), the walk follows
 * argv tokens ONLY while they descend into a registered subcommand and stops at
 * the first token that is not a child of the current node — so a trailing
 * positional like `branches view bch_123` resolves to `branches.view`, never
 * leaking the id `bch_123` into the envelope `command` field (or into logs).
 *
 * Without `knownCommands`, falls back to the legacy heuristic: collect leading
 * non-flag tokens up to `maxSegments` (default 3, the deepest nesting in the
 * tree). The command name is informational — consumers key off `ok`/`data`.
 * Falls back to `"unknown"` when argv has no command token (bare `better-update`).
 */
export const resolveCommandName = (
  argv: readonly string[],
  options?: { readonly maxSegments?: number; readonly knownCommands?: KnownCommandTree },
): string => {
  const tokens = argv.slice(ARGV_COMMAND_OFFSET);
  const segments: string[] = [];

  const { knownCommands } = options ?? {};
  if (knownCommands) {
    let node: KnownCommandTree = knownCommands;
    for (const token of tokens) {
      const next: KnownCommandTree | undefined = node[token];
      if (isFlag(token) || next === undefined) {
        break;
      }
      segments.push(token);
      node = next;
    }
    return segments.length === 0 ? "unknown" : segments.join(".");
  }

  const maxSegments = options?.maxSegments ?? 3;
  for (const token of tokens) {
    if (isFlag(token) || segments.length >= maxSegments) {
      break;
    }
    segments.push(token);
  }
  return segments.length === 0 ? "unknown" : segments.join(".");
};
