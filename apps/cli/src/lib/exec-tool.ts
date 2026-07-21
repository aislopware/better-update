/**
 * Generic never-failing external-tool runner shared by the macOS signing and
 * notarization libs (same contract as {@link runAltool} in altool.ts): the
 * Effect always succeeds with an {@link ExecResult}, and callers decide what a
 * non-zero exit means by parsing the captured streams.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Effect, Schema } from "effect";

import type { ExecResult } from "./altool";

const execFileAsync = promisify(execFile);

const ExecErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.Number),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});

// `notarytool log` can return a multi-megabyte developer log; keep the buffer
// well above it so a large log surfaces instead of killing the child.
const MAX_TOOL_BUFFER = 64 * 1024 * 1024;

export const runTool = (
  bin: string,
  args: readonly string[],
  extraEnv?: Record<string, string>,
): Effect.Effect<ExecResult> =>
  Effect.tryPromise({
    try: async (): Promise<ExecResult> => {
      // `env` replaces (not merges) the child env, so inherit process.env.
      const options = extraEnv
        ? {
            encoding: "utf8" as const,
            maxBuffer: MAX_TOOL_BUFFER,
            env: { ...process.env, ...extraEnv },
          }
        : { encoding: "utf8" as const, maxBuffer: MAX_TOOL_BUFFER };
      const { stdout, stderr } = await execFileAsync(bin, [...args], options);
      return { exitCode: 0, stdout, stderr };
    },
    catch: (error: unknown): ExecResult => {
      const parsed = Schema.decodeUnknownSync(ExecErrorSchema, { onExcessProperty: "ignore" })(
        typeof error === "object" && error !== null ? error : {},
      );
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- stdout legitimately empty when the tool fails fast, distinguished by exitCode
      const stdout = parsed.stdout ?? "";
      const stderr = parsed.stderr ?? String(error);
      return {
        exitCode: parsed.code ?? 1,
        stdout,
        stderr: stderr === "" ? String(error) : stderr,
      };
    },
  }).pipe(Effect.catchAll((result) => Effect.succeed(result)));

/** Best human-readable failure detail: the combined raw streams, else a stub. */
export const execFailureDetail = (result: ExecResult): string => {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  return combined.length > 0 ? combined : "no output";
};
