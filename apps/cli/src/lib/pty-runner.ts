import { accessSync, chmodSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { Effect } from "effect";
import { spawn } from "node-pty";

import type { IPty } from "node-pty";

import { currentLogPrefix, finalCarriageSegment } from "./log-prefix";
import { OutputMode } from "./output-mode";

export interface PtyRunInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /**
   * Terminal name the subprocess sees as `TERM` (node-pty overwrites `env.TERM`
   * with this). Defaults to `xterm-256color`; prefixed line mode passes `dumb`
   * so tools fall back to sequential output instead of cursor-movement redraws.
   */
  readonly terminalName?: string;
  /**
   * When true, raw subprocess output bytes are NOT forwarded to
   * `process.stdout` — only `onLine` callbacks decide what to print. Use when
   * a formatter (e.g. xcpretty) replaces the raw stream entirely. Defaults to
   * false (live tee).
   */
  readonly silent?: boolean;
  /**
   * Inspect each completed (`\n`-terminated) line of subprocess output.
   * Return a string to APPEND to stdout (annotation pattern) or `undefined` to
   * skip. In live-tee mode the raw line is echoed first; in `silent` mode
   * `onLine` is the only output channel.
   */
  readonly onLine?: (line: string) => string | undefined;
}

// @types/node declares columns/rows as `number` but at runtime they can be
// `undefined` when stdout isn't a TTY (CI, piped output). Pick safe defaults.
const ptyDimensions = (): { readonly cols: number; readonly rows: number } => {
  const stdout = process.stdout as { columns?: number; rows?: number };
  return {
    cols: typeof stdout.columns === "number" && stdout.columns > 0 ? stdout.columns : 120,
    rows: typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : 40,
  };
};

// node-pty wants `Record<string, string>`, but NodeJS.ProcessEnv values are
// `string | undefined`. Drop undefined entries so the merge is type-safe.
const mergeEnv = (overrides: Readonly<Record<string, string>>): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value;
  }
  return merged;
};

// Bun's global install (and some pnpm setups) strip the executable bit from
// prebuilt binaries shipped via `prebuild-install`. node-pty's `spawn-helper`
// is the canonical victim: without +x, `posix_spawnp` inside the native module
// fails with an opaque "posix_spawnp failed." We chmod it once per process so
// the CLI works regardless of how it was installed.
let spawnHelperChecked = false;
const ensureSpawnHelperExecutable = (): void => {
  if (spawnHelperChecked) {
    return;
  }
  spawnHelperChecked = true;
  if (process.platform === "win32") {
    return;
  }
  try {
    const nodeRequire = createRequire(import.meta.url);
    const helperPath = path.join(
      path.dirname(nodeRequire.resolve("node-pty/package.json")),
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    try {
      accessSync(helperPath, fsConstants.X_OK);
    } catch {
      chmodSync(helperPath, 0o755);
    }
  } catch {
    // Helper missing (linux build-from-source) or unwritable — let spawn fail
    // with its own error rather than masking it here.
  }
};

const trySpawn = (input: PtyRunInput): IPty | Error => {
  ensureSpawnHelperExecutable();
  const { cols, rows } = ptyDimensions();
  try {
    return spawn(input.command, [...input.args], {
      name: input.terminalName ?? "xterm-256color",
      cols,
      rows,
      cwd: input.cwd,
      env: mergeEnv(input.env),
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};

/**
 * Run a command in a pseudo-terminal so the subprocess sees a real TTY
 * (preserves spinners, progress bars, and ANSI colors emitted by tools like
 * CocoaPods and `expo prebuild`). Subprocess output is tee'd: forwarded to the
 * native build-log stream as raw bytes (so colors/positioning are preserved),
 * and also buffered into lines for the optional `onLine` callback.
 *
 * The build-log stream is `process.stdout` in human mode but `process.stderr`
 * in `--json`/CI mode: a stdout-only JSON consumer must read exactly one
 * envelope from stdout, so the (potentially thousands of lines of) native build
 * log is redirected to stderr where it is acceptable chrome. This is why the
 * effect requires `OutputMode`.
 *
 * Returns the subprocess exit code. Spawn failures and signal exits surface
 * as non-zero exit codes (128+signal for Unix-style signal exits).
 */
export const runInPty = (input: PtyRunInput): Effect.Effect<number, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    const prefix = yield* currentLogPrefix;
    // JSON mode: the success/error envelope is the WHOLE stdout payload, so the
    // raw native build log goes to stderr instead of polluting it.
    const logStream = mode.json ? process.stderr : process.stdout;
    // Parallel platform builds: rewrite the live tee into prefixed line mode so
    // the two subprocess streams interleave whole, attributable lines. Formatter
    // callers (`silent: true`) own their writes and prefix at the write site.
    const effective =
      prefix === undefined || input.silent === true ? input : withLinePrefix(input, prefix);
    return yield* runInPtyWithStream(effective, logStream);
  });

/**
 * Rewrite a live-tee input for prefixed line mode: raw chunk forwarding is
 * disabled and every completed line is re-emitted with the fiber's platform
 * tag. The subprocess sees `TERM=dumb` — cursor-movement redraws can't be
 * replayed line-by-line — and CR-only spinner frames collapse to their final
 * rendered state.
 */
const withLinePrefix = (input: PtyRunInput, prefix: string): PtyRunInput => ({
  ...input,
  silent: true,
  terminalName: "dumb",
  onLine: (line) => {
    const rendered = finalCarriageSegment(line);
    const annotation = input.onLine?.(rendered);
    const tagged = `${prefix}${rendered}`;
    return annotation === undefined ? tagged : `${tagged}\n${prefix}${annotation}`;
  },
});

const runInPtyWithStream = (
  input: PtyRunInput,
  logStream: NodeJS.WriteStream,
): Effect.Effect<number> =>
  Effect.async<number>((resume) => {
    const spawned = trySpawn(input);
    if (spawned instanceof Error) {
      process.stderr.write(`Failed to spawn "${input.command}" in pty: ${spawned.message}\n`);
      resume(Effect.succeed(1));
      return undefined;
    }
    const proc = spawned;

    let lineBuf = "";

    const handleLine = (line: string): void => {
      if (input.onLine === undefined) {
        return;
      }
      const annotation = input.onLine(line);
      if (annotation !== undefined) {
        logStream.write(`${annotation}\n`);
      }
    };

    proc.onData((chunk) => {
      if (input.silent !== true) {
        logStream.write(chunk);
      }
      if (input.onLine === undefined) {
        return;
      }
      lineBuf += chunk;
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).replace(/\r$/u, "");
        lineBuf = lineBuf.slice(nl + 1);
        handleLine(line);
        nl = lineBuf.indexOf("\n");
      }
    });

    const handleResize = (): void => {
      const { cols, rows } = ptyDimensions();
      try {
        proc.resize(cols, rows);
      } catch {
        // pty closed between SIGWINCH and the resize call — ignore.
      }
    };
    process.stdout.on("resize", handleResize);

    proc.onExit(({ exitCode, signal }) => {
      process.stdout.off("resize", handleResize);
      if (lineBuf.length > 0) {
        handleLine(lineBuf.replace(/\r$/u, ""));
        lineBuf = "";
      }
      const code = signal !== undefined && signal !== 0 ? 128 + signal : exitCode;
      resume(Effect.succeed(code));
    });

    return Effect.sync(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
      process.stdout.off("resize", handleResize);
    });
  });
