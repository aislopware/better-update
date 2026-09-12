import os from "node:os";
import process from "node:process";

import { Effect } from "effect";

import { currentLogPrefix, finalCarriageSegment } from "./log-prefix";
import { OutputMode } from "./output-mode";

export interface PtyRunInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /**
   * Terminal name the subprocess sees as `TERM` (the pty overwrites `env.TERM`
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

// Bun.spawn wants `Record<string, string>`, but NodeJS.ProcessEnv values are
// `string | undefined`. Drop undefined entries so the merge is type-safe. TERM
// is pinned to the pty name, matching what node-pty used to do.
const mergeEnv = (
  overrides: Readonly<Record<string, string>>,
  terminalName: string,
): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value;
  }
  merged["TERM"] = terminalName;
  return merged;
};

interface PtySession {
  readonly terminal: Bun.Terminal;
  readonly proc: Bun.Subprocess;
  /** Resolves once the pty stream hit EOF — every byte has been delivered. */
  readonly drained: Promise<void>;
}

const trySpawn = (input: PtyRunInput, onData: (chunk: Uint8Array) => void): PtySession | Error => {
  const { cols, rows } = ptyDimensions();
  const terminalName = input.terminalName ?? "xterm-256color";
  const { promise: drained, resolve: markDrained } = Promise.withResolvers<undefined>();
  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: terminalName,
    data: (_terminal, data) => {
      onData(data);
    },
    exit: () => {
      markDrained(undefined);
    },
  });
  try {
    const proc = Bun.spawn([input.command, ...input.args], {
      terminal,
      cwd: input.cwd,
      env: mergeEnv(input.env, terminalName),
    });
    return { terminal, proc, drained };
  } catch (error) {
    terminal.close();
    return error instanceof Error ? error : new Error(String(error));
  }
};

// Unix-style signal exit: 128 + the signal number, as a shell would report it.
const exitCodeFor = (proc: Bun.Subprocess, exitCode: number): number => {
  const signal = proc.signalCode;
  if (signal === null) {
    return exitCode;
  }
  return 128 + os.constants.signals[signal];
};

// After the child exits the pty can still hold unread output (Bun delivers it
// asynchronously). Wait for EOF, but bounded: a grandchild that inherited the
// pty keeps it open past the child's exit and must not hang the build.
const DRAIN_GRACE_MS = 1000;

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
  Effect.callback<number>((resume) => {
    let lineBuf = "";
    const decoder = new TextDecoder();

    const handleLine = (line: string): void => {
      if (input.onLine === undefined) {
        return;
      }
      const annotation = input.onLine(line);
      if (annotation !== undefined) {
        logStream.write(`${annotation}\n`);
      }
    };

    const onData = (chunk: Uint8Array): void => {
      if (input.silent !== true) {
        logStream.write(chunk);
      }
      if (input.onLine === undefined) {
        return;
      }
      lineBuf += decoder.decode(chunk, { stream: true });
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).replace(/\r+$/u, "");
        lineBuf = lineBuf.slice(nl + 1);
        handleLine(line);
        nl = lineBuf.indexOf("\n");
      }
    };

    const spawned = trySpawn(input, onData);
    if (spawned instanceof Error) {
      process.stderr.write(`Failed to spawn "${input.command}" in pty: ${spawned.message}\n`);
      resume(Effect.succeed(1));
      return undefined;
    }
    const { terminal, proc, drained } = spawned;

    const handleResize = (): void => {
      const { cols, rows } = ptyDimensions();
      try {
        terminal.resize(cols, rows);
      } catch {
        // pty closed between SIGWINCH and the resize call — ignore.
      }
    };
    process.stdout.on("resize", handleResize);

    const finish = (exitCode: number): void => {
      process.stdout.off("resize", handleResize);
      terminal.close();
      lineBuf += decoder.decode();
      if (lineBuf.length > 0) {
        handleLine(lineBuf.replace(/\r+$/u, ""));
        lineBuf = "";
      }
      resume(Effect.succeed(exitCodeFor(proc, exitCode)));
    };

    proc.exited
      .then(async (exitCode) => {
        await Promise.race([drained, Bun.sleep(DRAIN_GRACE_MS)]);
        finish(exitCode);
      })
      .catch((error: unknown) => {
        process.stderr.write(`pty wait failed for "${input.command}": ${String(error)}\n`);
        finish(1);
      });

    return Effect.sync(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
      terminal.close();
      process.stdout.off("resize", handleResize);
    });
  });
