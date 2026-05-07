#!/usr/bin/env node

import { spawn } from "node:child_process";

import { defineCommand, runMain } from "citty";
import { Effect } from "effect";

import pkg from "../package.json" with { type: "json" };
import { CliLive } from "./app-layer";
import { analyticsCommand } from "./commands/analytics";
import { auditLogsCommand } from "./commands/audit-logs";
import { branchesCommand } from "./commands/branches";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { channelsCommand } from "./commands/channels";
import { credentialsCommand } from "./commands/credentials";
import { envCommand } from "./commands/env";
import { fingerprintCommand } from "./commands/fingerprint";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { projectsCommand } from "./commands/projects";
import { statusCommand } from "./commands/status";
import { updateCommand } from "./commands/update";
import { bootstrapVersionCheck, refreshVersionCacheIfStale } from "./lib/version-notifier";

const REFRESH_VERSION_CACHE_FLAG = "__refresh-version-cache";

if (process.argv[2] === REFRESH_VERSION_CACHE_FLAG) {
  await Effect.runPromise(refreshVersionCacheIfStale.pipe(Effect.provide(CliLive)));
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
        Effect.provide(CliLive),
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
  },
});

await runMain(main);
