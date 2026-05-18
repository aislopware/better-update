#!/usr/bin/env node

import { spawn } from "node:child_process";

import { defineCommand, runMain } from "citty";
import { Effect } from "effect";

import pkg from "../package.json" with { type: "json" };
import { makeCliLive } from "./app-layer";
import { analyticsCommand } from "./commands/analytics";
import { appleCommand } from "./commands/apple";
import { auditLogsCommand } from "./commands/audit-logs";
import { autocompleteCommand } from "./commands/autocomplete";
import { branchesCommand } from "./commands/branches";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { channelsCommand } from "./commands/channels";
import { credentialsCommand } from "./commands/credentials";
import { devicesCommand } from "./commands/devices";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { fingerprintCommand } from "./commands/fingerprint";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { migrateConfigCommand } from "./commands/migrate-config";
import { openCommand } from "./commands/open";
import { projectsCommand } from "./commands/projects";
import { statusCommand } from "./commands/status";
import { updateCommand } from "./commands/update";
import { webhooksCommand } from "./commands/webhooks";
import { whoamiCommand } from "./commands/whoami";
import { setActiveCliLayer } from "./lib/citty-effect";
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
      bootstrapVersionCheck(pkg.version, import.meta.url, spawnDetachedRefresh).pipe(
        Effect.provide(cliLayer),
      ),
    );
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    init: initCommand,
    status: statusCommand,
    projects: projectsCommand,
    branches: branchesCommand,
    channels: channelsCommand,
    build: buildCommand,
    builds: buildsCommand,
    credentials: credentialsCommand,
    env: envCommand,
    fingerprint: fingerprintCommand,
    update: updateCommand,
    analytics: analyticsCommand,
    "audit-logs": auditLogsCommand,
    whoami: whoamiCommand,
    open: openCommand,
    doctor: doctorCommand,
    devices: devicesCommand,
    webhooks: webhooksCommand,
    autocomplete: autocompleteCommand,
    "migrate-config": migrateConfigCommand,
    apple: appleCommand,
  },
});

await runMain(main);
