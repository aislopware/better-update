/**
 * Argv after the first `--` separator. Captured at entry point so commands like
 * `env exec` can read raw command + args without citty interpreting them as flags.
 * `null` means no separator was present.
 */
let trailing: readonly string[] | null = null;

export const splitTrailingArgv = (
  argv: readonly string[],
): { readonly mainArgs: readonly string[]; readonly trailing: readonly string[] | null } => {
  const idx = argv.indexOf("--");
  if (idx === -1) {
    return { mainArgs: argv, trailing: null };
  }
  return { mainArgs: argv.slice(0, idx), trailing: argv.slice(idx + 1) };
};

export const setExecTrailingArgv = (args: readonly string[] | null): void => {
  trailing = args;
};

export const getExecTrailingArgv = (): readonly string[] | null => trailing;
