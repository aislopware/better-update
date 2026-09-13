// Must stay the FIRST import: `@expo/require-utils` snapshots the Node API
// this installs while `@expo/config-plugins` loads during startup, so it has
// to run before any other import is evaluated — only a bare import can.
// eslint-disable-next-line import/no-unassigned-import -- polyfill must be evaluated before every other import; a named import + call would run after them
import "./lib/strip-typescript-types-shim";

import { spawn } from "node:child_process";
import { Console as NodeConsole } from "node:console";

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, Layer, Runtime, Stdio } from "effect";
import { CliConfig, Command } from "effect/unstable/cli";

import type { CliError } from "effect/unstable/cli";

import pkg from "../package.json" with { type: "json" };
import { CliLive, MaintenanceLive } from "./app-layer";
import { commandRegistry } from "./command-registry";
import { CliRoot } from "./lib/cli-root";
import {
  buildKnownCommandTree,
  makeCommandNameLayer,
  resolveCommandName,
} from "./lib/command-output";
import { makeErrorEnvelope, serializeEnvelope } from "./lib/envelope";
import { CLI_BUILT_INS, detectJsonMode, GLOBAL_FLAGS } from "./lib/global-flags";
import { InteractiveMode } from "./lib/interactive-mode";
import { enforceMinVersion } from "./lib/min-version-gate";
import { isStandaloneBinary } from "./lib/standalone";
import { bootstrapVersionCheck, refreshVersionCacheIfStale } from "./lib/version-notifier";
import { CliRuntime, CliRuntimeLive } from "./services/cli-runtime";

const REFRESH_VERSION_CACHE_FLAG = "__refresh-version-cache";

/** The server has retired this CLI version; the gate already printed why. */
class CliRetiredError extends Data.TaggedError("CliRetiredError") {}

// Re-invoke ourselves for the background cache refresh. Inside the compiled
// single binary `process.execPath` IS the CLI, so no entry file is passed; under
// `bun src/index.ts` (dev) the entry file has to be repeated.
const spawnDetachedRefresh = (): void => {
  const entry = isStandaloneBinary() ? [] : [import.meta.filename];
  const child = spawn(process.execPath, [...entry, REFRESH_VERSION_CACHE_FLAG], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

// Runs before every command handler (inside the root command's context, so it
// sees the parsed global flags). Hard gate first: refuse to run when the server
// has retired this CLI version — fails open when the minimum can't be resolved.
const preflight = Effect.gen(function* () {
  const blocked = yield* enforceMinVersion(pkg.version);
  if (blocked) {
    return yield* new CliRetiredError();
  }
  const mode = yield* InteractiveMode;
  yield* bootstrapVersionCheck(pkg.version, spawnDetachedRefresh, {
    // Suppress the upgrade notice under --json / --non-interactive / CI — EAS
    // parity: it is stderr chrome a machine consumer has no use for.
    quiet: !mode.allow,
  });
});

const tree = Command.make("better-update").pipe(
  Command.withDescription("Publish OTA updates and builds for Expo apps"),
  Command.withSubcommands(commandRegistry),
);

// The process console: handlers always get it, so the JSON envelope lands on
// stdout even when the surrounding parse phase was redirected (see `main`).
// Backed by the `process.stdout` stream rather than `globalThis.console`: Bun's
// own console writer is not drained at exit once the Terminal layer releases
// stdin, so anything past the first pipe buffer (64 KiB — a completion script,
// a long `--json` list) was silently cut off when piped.
const stdoutConsole = new NodeConsole({ stdout: process.stdout, stderr: process.stderr });

// Everything to stderr: used around the parse phase in --json mode so help /
// usage rendering can never pollute the single-envelope stdout stream.
const stderrConsole = new NodeConsole({ stdout: process.stderr, stderr: process.stderr });

const root = tree.pipe(
  Command.provideEffectDiscard(preflight),
  Command.provide(CliLive),
  Command.provide(makeCommandNameLayer(tree)),
  Command.provide(Layer.succeed(CliRoot, { command: tree, version: pkg.version })),
  Command.provide(Layer.succeed(Console.Console, stdoutConsole)),
  Command.withGlobalFlags(GLOBAL_FLAGS),
);

const setExitCode = (code: number) =>
  Effect.andThen(CliRuntime, (runtime) => runtime.setExitCode(code));

// `--help` and a bare group render help and succeed; every other CliError
// (unknown option, missing argument, invalid value, ...) is a usage error.
const isPlainHelp = (error: CliError.CliError): boolean =>
  error._tag === "ShowHelp" && error.errors.length === 0;

const usageErrorMessage = (error: CliError.CliError): string =>
  error._tag === "ShowHelp" ? error.errors.map((cause) => cause.message).join("\n") : error.message;

/**
 * Usage errors exit 2. Command.run already rendered help + the error on the
 * active console; in --json mode that console is stderr, and the machine
 * consumer additionally gets the standard error envelope on stdout.
 */
const reportUsageError = (
  error: CliError.CliError,
  args: readonly string[],
  json: boolean,
): Effect.Effect<void, never, CliRuntime> =>
  Effect.gen(function* () {
    if (isPlainHelp(error)) {
      return;
    }
    if (json) {
      const envelope = makeErrorEnvelope(resolveCommandName(args, buildKnownCommandTree(tree)), {
        code: 2,
        tag: "UsageError",
        message: usageErrorMessage(error),
      });
      yield* Console.log(serializeEnvelope(envelope)).pipe(
        Effect.provideService(Console.Console, stdoutConsole),
      );
    }
    yield* setExitCode(2);
  });

const main = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;
  const json = detectJsonMode(args);
  const run = Command.run(root, { version: pkg.version }).pipe(
    Effect.provide(CliConfig.layer({ builtIns: CLI_BUILT_INS })),
    Effect.catchTag("CliRetiredError", () => setExitCode(1)),
    Effect.matchEffect({
      onFailure: (error) => reportUsageError(error, args, json),
      onSuccess: () => Effect.void,
    }),
  );
  return yield* Effect.provideService(run, Console.Console, json ? stderrConsole : stdoutConsole);
});

// Let the stream buffers reach the pipe before `process.exit` — Bun does not
// flush them on a forced exit (a failed / interrupted main fiber; success
// paths set `process.exitCode` and exit naturally).
const flushStdio = async (): Promise<void> =>
  new Promise((resolve) => {
    process.stdout.write("", () => {
      process.stderr.write("", () => {
        resolve();
      });
    });
  });

const program =
  process.argv[2] === REFRESH_VERSION_CACHE_FLAG
    ? refreshVersionCacheIfStale.pipe(Effect.provide(MaintenanceLive))
    : main.pipe(Effect.provide(Layer.mergeAll(BunServices.layer, CliRuntimeLive)));

BunRuntime.runMain(program, {
  teardown: (exit, onExit) => {
    Runtime.defaultTeardown(exit, (code) => {
      flushStdio().then(
        () => {
          onExit(code);
        },
        () => {
          onExit(code);
        },
      );
    });
  },
});
