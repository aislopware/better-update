#!/usr/bin/env bun

import process from "node:process";

import { Command } from "@effect/cli";
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

import { CliLive } from "./app-layer";
import { analyticsCommand } from "./commands/analytics";
import { auditLogsCommand } from "./commands/audit-logs";
import { branchesCommand } from "./commands/branches";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { channelsCommand } from "./commands/channels";
import { credentialsCommand } from "./commands/credentials";
import { envCommand } from "./commands/env";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { projectsCommand } from "./commands/projects";
import { statusCommand } from "./commands/status";
import { updateCommand } from "./commands/update";

const command = Command.make("better-update", {}, () =>
  Console.log("better-update CLI - Run with --help to see available commands"),
).pipe(
  Command.withSubcommands([
    loginCommand,
    logoutCommand,
    initCommand,
    statusCommand,
    projectsCommand,
    branchesCommand,
    channelsCommand,
    buildCommand,
    buildsCommand,
    credentialsCommand,
    envCommand,
    updateCommand,
    analyticsCommand,
    auditLogsCommand,
  ]),
);

const cli = Command.run(command, {
  name: "better-update",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(CliLive), BunRuntime.runMain);
