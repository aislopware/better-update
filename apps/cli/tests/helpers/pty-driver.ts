import { setTimeout as sleep } from "node:timers/promises";

import { spawn, type IPty } from "node-pty";

export interface PtySpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cols?: number;
  readonly rows?: number;
}

export interface PtyDriver {
  readonly output: () => string;
  readonly stripped: () => string;
  readonly expect: (
    pattern: string | RegExp,
    options?: { readonly timeoutMs?: number },
  ) => Promise<void>;
  readonly send: (text: string) => void;
  readonly enter: () => void;
  readonly down: (count?: number) => void;
  readonly up: (count?: number) => void;
  readonly waitExit: (options?: { readonly timeoutMs?: number }) => Promise<number>;
  readonly kill: () => void;
}

const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex -- stripping ANSI escapes
  /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-ORZcf-ntqry=><]/g;

export const stripAnsi = (input: string) => input.replace(ANSI_REGEX, "");

export const spawnPty = (
  command: string,
  args: ReadonlyArray<string>,
  options?: PtySpawnOptions,
): PtyDriver => {
  const ptyProcess: IPty = spawn(command, [...args], {
    cols: options?.cols ?? 120,
    rows: options?.rows ?? 40,
    cwd: options?.cwd ?? process.cwd(),
    env: { ...process.env, ...options?.env } as Record<string, string>,
    name: "xterm-256color",
  });

  let buffer = "";
  let exitCode: number | null = null;
  const waiters: Array<() => void> = [];

  const drainWaiters = () => {
    const pending = waiters.splice(0);
    for (const waiter of pending) waiter();
  };

  ptyProcess.onData((chunk) => {
    buffer += chunk;
    drainWaiters();
  });

  ptyProcess.onExit(({ exitCode: code }) => {
    exitCode = code;
    drainWaiters();
  });

  const waitFor = (timeoutMs: number, predicate: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      if (predicate()) {
        resolve();
        return;
      }
      let settled = false;
      const tick = () => {
        if (settled) return;
        if (predicate()) {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else if (exitCode !== null) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `pty exited (code=${exitCode}) before predicate matched. Buffer:\n${stripAnsi(buffer)}`,
            ),
          );
        } else {
          waiters.push(tick);
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`pty wait timed out after ${timeoutMs}ms. Buffer:\n${stripAnsi(buffer)}`));
      }, timeoutMs);
      waiters.push(tick);
    });

  return {
    output: () => buffer,
    stripped: () => stripAnsi(buffer),
    expect: async (pattern, { timeoutMs = 5_000 } = {}) => {
      const matcher =
        typeof pattern === "string"
          ? (text: string) => text.includes(pattern)
          : (text: string) => pattern.test(text);
      await waitFor(timeoutMs, () => matcher(stripAnsi(buffer)));
    },
    send: (text) => {
      ptyProcess.write(text);
    },
    enter: () => {
      ptyProcess.write("\r");
    },
    down: (count = 1) => {
      for (let i = 0; i < count; i += 1) ptyProcess.write("\u001b[B");
    },
    up: (count = 1) => {
      for (let i = 0; i < count; i += 1) ptyProcess.write("\u001b[A");
    },
    waitExit: async ({ timeoutMs = 10_000 } = {}) => {
      await waitFor(timeoutMs, () => exitCode !== null);
      // Give the pty a beat to flush any trailing bytes.
      await sleep(10);
      return exitCode ?? -1;
    },
    kill: () => {
      ptyProcess.kill();
    },
  };
};
