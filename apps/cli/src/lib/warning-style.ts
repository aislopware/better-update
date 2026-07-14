import chalk from "chalk";
import { Console, Effect } from "effect";

import { currentLogPrefix, prefixLine } from "./log-prefix";
import { OutputMode } from "./output-mode";

// Match ANSI escapes (CSI / OSC introduced by ESC or 8-bit CSI). Mirrors the
// regex used in tests/helpers/pty-driver.ts. Handles SGR, DEC private modes,
// and the parameter forms commonly emitted by xcodebuild, CocoaPods, etc.
const ANSI_REGEX_GLOBAL = /[][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-ORZcf-ntqry=><]/gu;

const stripAnsi = (input: string): string => input.replaceAll(ANSI_REGEX_GLOBAL, "");

const hasAnsi = (input: string): boolean => {
  ANSI_REGEX_GLOBAL.lastIndex = 0;
  return ANSI_REGEX_GLOBAL.test(input);
};

// Conservative pattern set — restrictive to avoid false positives like
// "0 warnings, 1 error" or paths containing the word "warning".
// CocoaPods uses `[!] ...`; Xcode tags deprecation/IDE notices with `[MT]`.
const WARNING_PATTERNS: readonly RegExp[] = [
  /^\s*warning:/iu,
  /^\s*\[!\]/u,
  /^\s*WARNING:/u,
  /^\s*WARN\b/u,
  /\bis deprecated\b/iu,
  /^\s*DEPRECATION\b/iu,
  /\[MT\]/u,
  /⚠/u,
];

export const isWarningLine = (rawLine: string): boolean => {
  const plain = stripAnsi(rawLine);
  return WARNING_PATTERNS.some((pattern) => pattern.test(plain));
};

/**
 * Style a single output line as a warning. If the line already contains ANSI
 * escapes (the subprocess pre-colored it), only prepend our yellow ⚠ marker
 * so the original colors survive. Otherwise color the whole line yellow.
 */
export const styleWarningLine = (line: string): string =>
  hasAnsi(line) ? `${chalk.yellow("⚠")} ${line}` : chalk.yellow(`⚠ ${line}`);

/**
 * Emit a CLI-owned warning. Suppressed in JSON mode; in human mode writes a
 * yellow, ⚠-prefixed line to stderr so it stands out from regular info logs.
 */
export const printWarn = (message: string): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return;
    }
    yield* Console.warn(prefixLine(yield* currentLogPrefix, chalk.yellow(`⚠ warning: ${message}`)));
  });
