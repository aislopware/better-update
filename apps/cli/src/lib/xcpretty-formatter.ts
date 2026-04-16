import { ExpoRunFormatter } from "@expo/xcpretty";

export interface XcodebuildFormatter {
  /** Feed a line of raw xcodebuild output. Returns formatted lines (0 or more). */
  readonly pipe: (line: string) => readonly string[];
  /** Get a build summary after the process completes. */
  readonly getBuildSummary: () => string;
}

/**
 * Create a stateful xcodebuild output formatter backed by `@expo/xcpretty`.
 * Each `pipe(line)` call may return zero or more formatted lines — zero means
 * the line was suppressed (e.g., intermediate compiler invocations).
 */
export const createXcodebuildFormatter = (projectRoot: string): XcodebuildFormatter => {
  const formatter = ExpoRunFormatter.create(projectRoot);
  return {
    pipe: (line: string) => formatter.pipe(line),
    getBuildSummary: () => formatter.getBuildSummary(),
  };
};
