/**
 * Thin wrapper around `xcrun altool` for App Store delivery: run it without
 * throwing (failures come back as an {@link ExecResult} with a non-zero exit), and
 * extract the real failure reason from altool's `--output-format xml` output.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Effect, Schema } from "effect";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const ExecErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.Number),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});

export const runAltool = (args: readonly string[], extraEnv?: Record<string, string>) =>
  Effect.tryPromise({
    try: async (): Promise<ExecResult> => {
      // `env` replaces (not merges) the child env, so inherit process.env — the
      // app-specific-password path reads the password from `@env:` at runtime.
      // `encoding` keeps the promisified overload returning strings, not Buffers.
      const options = extraEnv
        ? { encoding: "utf8" as const, env: { ...process.env, ...extraEnv } }
        : { encoding: "utf8" as const };
      const { stdout, stderr } = await execFileAsync("xcrun", ["altool", ...args], options);
      return { exitCode: 0, stdout, stderr };
    },
    catch: (error: unknown): ExecResult => {
      const parsed = Schema.decodeUnknownSync(ExecErrorSchema, { onExcessProperty: "ignore" })(
        typeof error === "object" && error !== null ? error : {},
      );
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- stdout legitimately empty when altool fails fast, distinguished by exitCode
      const stdout = parsed.stdout ?? "";
      const stderr = parsed.stderr ?? String(error);
      return {
        exitCode: parsed.code ?? 1,
        stdout,
        stderr: stderr === "" ? String(error) : stderr,
      };
    },
  }).pipe(Effect.catchAll((result) => Effect.succeed(result)));

const unescapeXml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/**
 * altool with `--output-format xml` writes the real failure detail to a stdout
 * plist (`product-errors`), leaving stderr with only a generic
 * "UPLOAD FAILED … ExitFailure (N)" banner. Pull the human-readable messages so
 * the surfaced error names the actual cause (asset validation, export compliance,
 * a duplicate build number, a missing app record…).
 */
export const extractAltoolErrors = (xml: string): readonly string[] =>
  [...xml.matchAll(/<key>message<\/key>\s*<string>(?<message>[\s\S]*?)<\/string>/gu)].flatMap(
    (match) => {
      const message = match.groups?.["message"];
      return message === undefined ? [] : [unescapeXml(message).trim()];
    },
  );

/** Best human-readable altool failure detail: parsed product-errors, else raw streams. */
export const altoolFailureDetail = (result: ExecResult): string => {
  const messages = extractAltoolErrors(result.stdout);
  if (messages.length > 0) {
    return messages.join("; ");
  }
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  return combined.length > 0 ? combined : "no output";
};
