import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Command } from "effect/unstable/cli";

import { commandRegistry } from "../../../src/command-registry";

/**
 * Integration tier: the BUILT binary (`dist/better-update`, compiled by
 * `pretest:integrations`) is spawned as a real process — argv parsing, global
 * flags, the JSON envelope, exit codes and stdout/stderr separation are all
 * observed from the outside, exactly as a shell or CI job sees them.
 *
 * No server: every run is fully isolated (empty HOME + cwd, unroutable server
 * URL, `CI=1`), so a command either fails before any network call (auth,
 * validation, usage) or is a pure local command. Anything that would prompt
 * fails with `InteractiveProhibitedError` instead of blocking — and a command
 * that DID block would trip the spawn timeout, which is itself a contract.
 */

const CLI_DIR = path.resolve(import.meta.dirname, "../../..");
export const CLI_BINARY = path.join(CLI_DIR, "dist/better-update");

/** TCP port 9 (discard) on loopback: connection refused immediately, never routed. */
export const UNROUTABLE_SERVER_URL = "http://127.0.0.1:9";

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Process ended by the harness timeout (a hang — never acceptable in CI mode). */
  readonly timedOut: boolean;
}

export interface CliRunOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface CliSandbox {
  readonly homeDir: string;
  readonly cwd: string;
  readonly run: (args: readonly string[], options?: CliRunOptions) => Promise<CliResult>;
  readonly cleanup: () => void;
}

/** Fresh HOME + working directory per test file; nothing leaks between files. */
export const makeCliSandbox = (): CliSandbox => {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "better-update-int-home-"));
  const cwd = mkdtempSync(path.join(os.tmpdir(), "better-update-int-cwd-"));
  const run = async (args: readonly string[], options?: CliRunOptions): Promise<CliResult> =>
    new Promise((resolve) => {
      const child = spawn(CLI_BINARY, [...args], {
        cwd: options?.cwd ?? cwd,
        env: {
          PATH: process.env["PATH"],
          HOME: homeDir,
          CI: "1",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          BETTER_UPDATE_URL: UNROUTABLE_SERVER_URL,
          BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER: "1",
          ...options?.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options?.timeoutMs ?? 30_000);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? (signal === "SIGINT" ? 130 : 1),
          timedOut,
        });
      });
    });
  const cleanup = () => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  };
  return { homeDir, cwd, run, cleanup };
};

// ── labelled assertions (vitest's `expect(x, message)` form is lint-banned) ──

/** `toBe`/`toStrictEqual` keyed by a label so a failing walk names the command. */
export const expectIs = (label: string, actual: unknown, expected: unknown): void => {
  expect({ [label]: actual }).toStrictEqual({ [label]: expected });
};

export const expectLength = (label: string, actual: readonly unknown[], expected: number): void => {
  expectIs(`${label} (length)`, actual.length, expected);
};

export const expectContains = (
  label: string,
  haystack: string | readonly unknown[],
  needle: unknown,
): void => {
  const found =
    typeof haystack === "string" ? haystack.includes(String(needle)) : haystack.includes(needle);
  expectIs(`${label} contains ${JSON.stringify(needle)}`, found, true);
};

export const expectNotContains = (label: string, haystack: string, needle: string): void => {
  expectIs(`${label} does not contain ${JSON.stringify(needle)}`, haystack.includes(needle), false);
};

export const expectMatches = (label: string, actual: unknown, expected: object): void => {
  expect({ [label]: actual }).toMatchObject({ [label]: expected });
};

// ── envelope helpers ──────────────────────────────────────────────

export interface ErrorEnvelope {
  readonly schemaVersion: number;
  readonly ok: false;
  readonly command: string;
  readonly error: { readonly code: number; readonly tag: string; readonly message: string };
}

export interface SuccessEnvelope {
  readonly schemaVersion: number;
  readonly ok: true;
  readonly command: string;
  readonly data: unknown;
}

/** stdout in --json mode is EXACTLY one line holding one envelope. */
export const parseEnvelope = (stdout: string): SuccessEnvelope | ErrorEnvelope => {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  expectLength(`expected a single envelope line, got:\n${stdout}`, lines, 1);
  const parsed: unknown = JSON.parse(lines[0] ?? "");
  expect(parsed).toMatchObject({ schemaVersion: 1 });
  return parsed as SuccessEnvelope | ErrorEnvelope;
};

export const parseErrorEnvelope = (stdout: string): ErrorEnvelope => {
  const envelope = parseEnvelope(stdout);
  expect(envelope.ok).toBe(false);
  return envelope as ErrorEnvelope;
};

// ── command tree walk (the same registry index.ts mounts) ─────────

export interface CommandPath {
  /** Tokens after `better-update`, e.g. `["devices", "list"]`. */
  readonly tokens: readonly string[];
  readonly command: Command.Command.Any;
  readonly isGroup: boolean;
}

const children = (command: Command.Command.Any): readonly Command.Command.Any[] =>
  command.subcommands.flatMap((group) => group.commands);

const walk = (commands: readonly Command.Command.Any[], prefix: readonly string[]): CommandPath[] =>
  commands.flatMap((command) => {
    const tokens = [...prefix, command.name];
    const nested = children(command);
    return [{ tokens, command, isGroup: nested.length > 0 }, ...walk(nested, tokens)];
  });

/** Every command path in the registry, groups included, in tree order. */
export const allCommandPaths = (): readonly CommandPath[] => walk(commandRegistry, []);

export const leafCommandPaths = (): readonly CommandPath[] =>
  allCommandPaths().filter((entry) => !entry.isGroup);

export const groupCommandPaths = (): readonly CommandPath[] =>
  allCommandPaths().filter((entry) => entry.isGroup);

/** Run `fn` over items with bounded concurrency (spawns are the bottleneck). */
export const mapConcurrently = async <Item, Result>(
  items: readonly Item[],
  concurrency: number,
  fn: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};
