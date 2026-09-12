import { Effect, Layer } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";

import { CliRuntime } from "../services/cli-runtime";
import { InteractiveMode } from "./interactive-mode";
import { OutputMode } from "./output-mode";

/**
 * Global flags every command accepts. Declared once on the root command
 * (`Command.withGlobalFlags`) so no leaf can shadow them; the parser provides
 * each as a `Setting` service to the handler context, and
 * {@link GlobalFlagsLayer} folds them into `OutputMode` + `InteractiveMode`.
 */
export const JsonFlag = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDescription("Emit machine-readable JSON instead of human-readable output"),
    Flag.withDefault(false),
  ),
});

export const NonInteractiveFlag = GlobalFlag.Setting("non-interactive")({
  flag: Flag.Boolean("non-interactive").pipe(
    Flag.withDescription("Never prompt; fail when a required value is not provided via flags"),
    Flag.withDefault(false),
  ),
});

export const InteractiveFlag = GlobalFlag.Setting("interactive")({
  flag: Flag.Boolean("interactive").pipe(
    Flag.withDescription("Allow interactive prompts even when CI is detected"),
    Flag.withDefault(false),
  ),
});

export const GLOBAL_FLAGS = [JsonFlag, NonInteractiveFlag, InteractiveFlag] as const;

/**
 * Built-in global flags the runner mounts on every command. The default list
 * also carries `--wizard`, an interactive walkthrough whose prompts run BEFORE
 * any handler — so before `--json`, `--non-interactive` and CI detection can
 * refuse them. An agent-first CLI cannot ship a flag that hangs in CI, so it is
 * left out; the others are pure output.
 */
export const CLI_BUILT_INS = [
  GlobalFlag.Help,
  GlobalFlag.Version,
  GlobalFlag.Completions,
  GlobalFlag.LogLevel,
] as const;

const BOOLEAN_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "json",
  "non-interactive",
  "interactive",
]);

/** Built-in settings that take a value (`--log-level debug` / `--log-level=debug`). */
const VALUE_GLOBAL_NAMES: ReadonlySet<string> = new Set(["log-level"]);

export interface GlobalFlagToken {
  /** Flag name without dashes (`json`, `log-level`, …). */
  readonly name: string;
  /** Boolean value for the `--json`-style settings; undefined for `--log-level`. */
  readonly value: boolean | undefined;
  /** Number of argv tokens the flag occupies (2 when its value is a separate token). */
  readonly span: 1 | 2;
}

const BOOLEAN_VALUES: Readonly<Record<string, boolean>> = { true: true, false: false };

const booleanValue = (token: string | undefined): boolean | undefined =>
  token === undefined ? undefined : BOOLEAN_VALUES[token];

/**
 * Describe the global flag starting at `args[index]`, mirroring every spelling
 * the parser accepts: `--x`, `--no-x`, `--x=true|false`, `--x true|false`, and
 * `--log-level <level>` / `--log-level=<level>`. Undefined when the token is
 * not a global flag. Shared by the pre-parse JSON detection and the envelope
 * command-name walk so both agree with the parser about which tokens are
 * flags and which are command segments.
 */
export const globalFlagAt = (
  args: readonly string[],
  index: number,
): GlobalFlagToken | undefined => {
  const token = args[index];
  if (token === undefined || !token.startsWith("--")) {
    return undefined;
  }
  const [rawName, inlineValue] = token.slice(2).split("=", 2);
  if (rawName === undefined) {
    return undefined;
  }
  if (VALUE_GLOBAL_NAMES.has(rawName)) {
    return inlineValue === undefined
      ? { name: rawName, value: undefined, span: 2 }
      : { name: rawName, value: undefined, span: 1 };
  }
  if (BOOLEAN_GLOBAL_NAMES.has(rawName)) {
    if (inlineValue !== undefined) {
      return { name: rawName, value: booleanValue(inlineValue) ?? true, span: 1 };
    }
    const separate = booleanValue(args[index + 1]);
    return separate === undefined
      ? { name: rawName, value: true, span: 1 }
      : { name: rawName, value: separate, span: 2 };
  }
  const negated = rawName.startsWith("no-") ? rawName.slice(3) : undefined;
  if (negated !== undefined && BOOLEAN_GLOBAL_NAMES.has(negated)) {
    return { name: negated, value: false, span: 1 };
  }
  return undefined;
};

/**
 * Whether `--json` is in effect for a raw argument list, decided BEFORE the
 * parser runs so the entrypoint can keep stdout machine-clean even when the
 * parse itself fails (usage error) and no handler — hence no `OutputMode` — ever
 * exists. Mirrors the parser: the FIRST `--json` / `--no-json` occurrence
 * decides, operands after `--` never count.
 */
export const detectJsonMode = (args: readonly string[]): boolean => {
  let index = 0;
  while (index < args.length) {
    if (args[index] === "--") {
      return false;
    }
    const flag = globalFlagAt(args, index);
    if (flag?.name === "json") {
      return flag.value ?? true;
    }
    index += flag?.span ?? 1;
  }
  return false;
};

export interface GlobalFlags {
  /** Emit machine-readable JSON instead of human-readable output. */
  readonly json: boolean;
  /**
   * Disallow interactive prompts. Errors out if a prompt is needed but no flag
   * value was provided. Always true when `json` is true (the JSON stdout
   * contract forbids prompts, which render to stdout).
   */
  readonly nonInteractive: boolean;
}

export interface RawGlobalFlags {
  readonly json: boolean;
  readonly nonInteractive: boolean;
  readonly interactive: boolean;
}

const isCi = (value: string | undefined): boolean => value === "true" || value === "1";

/**
 * Precedence (highest first):
 *   1. --json ALWAYS forces non-interactive. --json is a hard no-chrome-on-
 *      stdout contract; prompts render to stdout, so allowing a prompt in JSON
 *      mode would corrupt the single-envelope stream. json wins over an explicit
 *      --interactive (the `--interactive --json` combination resolves to
 *      non-interactive — json's contract is stronger).
 *   2. explicit --non-interactive forces non-interactive.
 *   3. explicit --interactive opts BACK IN under CI (overrides CI detection),
 *      but cannot override the --json contract (rule 1).
 *   4. CI detection defaults to non-interactive.
 */
export const resolveGlobalFlags = (flags: RawGlobalFlags, ci: string | undefined): GlobalFlags => ({
  json: flags.json,
  nonInteractive: flags.json || flags.nonInteractive || (!flags.interactive && isCi(ci)),
});

const resolvedFlags = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const ci = yield* runtime.getEnv("CI");
  return resolveGlobalFlags(
    {
      json: yield* JsonFlag,
      nonInteractive: yield* NonInteractiveFlag,
      interactive: yield* InteractiveFlag,
    },
    ci,
  );
});

/** `OutputMode` + `InteractiveMode` derived from the parsed global flags + CI env. */
export const GlobalFlagsLayer = Layer.mergeAll(
  Layer.effect(OutputMode, resolvedFlags.pipe(Effect.map((flags) => ({ json: flags.json })))),
  Layer.effect(
    InteractiveMode,
    resolvedFlags.pipe(Effect.map((flags) => ({ allow: !flags.nonInteractive }))),
  ),
);
