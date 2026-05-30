#!/usr/bin/env node

import { spawn } from "node:child_process";

import { defineCommand, runMain } from "citty";
import { Effect } from "effect";

import pkg from "../package.json" with { type: "json" };
import { makeCliLive } from "./app-layer";
import { commandRegistry } from "./command-registry";
import { setActiveCliLayer } from "./lib/citty-effect";
import { buildKnownCommandTree, setKnownCommandTree } from "./lib/command-output";
import { setExecTrailingArgv, splitTrailingArgv } from "./lib/exec-trailing-argv";
import { parseGlobalFlags, stripGlobalFlags } from "./lib/global-flags";
import { bootstrapVersionCheck, refreshVersionCacheIfStale } from "./lib/version-notifier";

const REFRESH_VERSION_CACHE_FLAG = "__refresh-version-cache";

// Parse + strip global flags before citty sees them. argv[0]=node, argv[1]=script, args start at [2].
const rawArgs = process.argv.slice(2);
const globalFlags = parseGlobalFlags(rawArgs);
const withoutGlobals = stripGlobalFlags(rawArgs);
// Split at `--` so subcommands like `env exec` can read raw trailing argv.
const { mainArgs, trailing } = splitTrailingArgv(withoutGlobals);
setExecTrailingArgv(trailing);
process.argv = [...process.argv.slice(0, 2), ...mainArgs];

const cliLayer = makeCliLive({
  json: globalFlags.json,
  interactive: !globalFlags.nonInteractive,
});
setActiveCliLayer(cliLayer);
// Feed the registry tree to the envelope command-name resolver so trailing
// positionals (ids) are never folded into the `command` field. Derived from the
// SAME registry index.ts ships, so it stays in sync by construction.
setKnownCommandTree(buildKnownCommandTree(commandRegistry));

if (process.argv[2] === REFRESH_VERSION_CACHE_FLAG) {
  await Effect.runPromise(refreshVersionCacheIfStale.pipe(Effect.provide(cliLayer)));
  process.exit(0);
}

const spawnDetachedRefresh = (): void => {
  const child = spawn(process.execPath, [import.meta.filename, REFRESH_VERSION_CACHE_FLAG], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

const main = defineCommand({
  meta: {
    name: "better-update",
    version: pkg.version,
    description: "Publish OTA updates and builds for Expo apps",
  },
  setup: async () => {
    await Effect.runPromise(
      bootstrapVersionCheck(pkg.version, import.meta.url, spawnDetachedRefresh, {
        // Suppress the upgrade notice under --json / --non-interactive / CI
        // (globalFlags.nonInteractive captures all three) — EAS parity.
        quiet: globalFlags.nonInteractive,
      }).pipe(Effect.provide(cliLayer)),
    );
  },
  subCommands: commandRegistry,
});

await runMain(main);
