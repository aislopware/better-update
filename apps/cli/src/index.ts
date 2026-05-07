#!/usr/bin/env node

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
import { printOutdatedWarning, refreshVersionCacheIfStale } from "./lib/version-notifier";

const main = defineCommand({
  meta: {
    name: "better-update",
    version: pkg.version,
    description: "Publish OTA updates and builds for Expo apps",
  },
  setup: async () => {
    await Effect.runPromise(
      printOutdatedWarning(pkg.version, import.meta.url).pipe(Effect.provide(CliLive)),
    );
    Effect.runFork(refreshVersionCacheIfStale.pipe(Effect.provide(CliLive)));
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
