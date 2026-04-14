#!/usr/bin/env bun

import process from "node:process";

import { Command } from "@effect/cli";
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

import { CliLive } from "./app-layer";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { credentialsCommand } from "./commands/credentials";
import { envCommand } from "./commands/env";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
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
    buildCommand,
    buildsCommand,
    credentialsCommand,
    envCommand,
    updateCommand,
  ]),
);

const cli = Command.run(command, {
  name: "better-update",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(CliLive), BunRuntime.runMain);
