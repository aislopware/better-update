export interface GlobalFlags {
  /** Emit machine-readable JSON instead of human-readable output. */
  readonly json: boolean;
  /**
   * Disallow interactive prompts. Errors out if a prompt is needed but no flag
   * value was provided. Always true when `json` is true (the JSON stdout
   * contract forbids prompts, which clack renders to stdout).
   */
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
  // Precedence (highest first):
  //   1. --json ALWAYS forces non-interactive. --json is a hard no-chrome-on-
  //      stdout contract; clack prompts render to process.stdout, so allowing a
  //      prompt in JSON mode would corrupt the single-envelope stream. json wins
  //      over an explicit --interactive (the `--interactive --json` combination
  //      resolves to non-interactive — json's contract is stronger).
  //   2. explicit --non-interactive forces non-interactive.
  //   3. explicit --interactive opts BACK IN under CI (overrides CI detection),
  //      but cannot override the --json contract (rule 1).
  //   4. CI detection defaults to non-interactive.
  const nonInteractive = json || explicitNonInteractive || (!explicitInteractive && isCi(env));
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
