import { accessSync, chmodSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { Effect } from "effect";
import { spawn } from "node-pty";

import type { IPty } from "node-pty";

export interface PtyRunInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
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
      name: "xterm-256color",
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
 * CocoaPods and `expo prebuild`). Subprocess output is tee'd: forwarded to
 * `process.stdout` as raw bytes (so colors/positioning are preserved), and
 * also buffered into lines for the optional `onLine` callback.
 *
 * Returns the subprocess exit code. Spawn failures and signal exits surface
 * as non-zero exit codes (128+signal for Unix-style signal exits).
 */
export const runInPty = (input: PtyRunInput): Effect.Effect<number> =>
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
        process.stdout.write(`${annotation}\n`);
      }
    };

    proc.onData((chunk) => {
      if (input.silent !== true) {
        process.stdout.write(chunk);
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
