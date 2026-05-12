export interface GlobalFlags {
  /** Emit machine-readable JSON instead of human-readable output. */
  readonly json: boolean;
  /** Disallow interactive prompts. Errors out if a prompt is needed but no flag value was provided. */
  readonly nonInteractive: boolean;
}

const FLAG_JSON = "--json";
const FLAG_NON_INTERACTIVE = "--non-interactive";
const FLAG_INTERACTIVE = "--interactive";

const isCi = (env: NodeJS.ProcessEnv): boolean => env["CI"] === "true" || env["CI"] === "1";

export const parseGlobalFlags = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): GlobalFlags => {
  const json = argv.includes(FLAG_JSON);
  const explicitNonInteractive = argv.includes(FLAG_NON_INTERACTIVE);
  const explicitInteractive = argv.includes(FLAG_INTERACTIVE);
  const nonInteractive =
    explicitNonInteractive || (!explicitInteractive && json) || (!explicitInteractive && isCi(env));
  return { json, nonInteractive };
};

/**
 * Remove global flags from argv before citty parses subcommand args. citty would
 * otherwise treat them as unknown args and fail or noise the help output.
 */
export const stripGlobalFlags = (argv: readonly string[]): readonly string[] =>
  argv.filter(
    (arg) => arg !== FLAG_JSON && arg !== FLAG_NON_INTERACTIVE && arg !== FLAG_INTERACTIVE,
  );
