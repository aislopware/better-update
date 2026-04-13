#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

import { buildsCommand } from "./commands/builds";
import { credentialsCommand } from "./commands/credentials";
import { envCommand } from "./commands/env";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { statusCommand } from "./commands/status";
import { AuthStoreLive } from "./services/auth-store";
import { ConfigStoreLive } from "./services/config-store";

const command = Command.make("better-update", {}, () =>
  Console.log("better-update CLI - Run with --help to see available commands"),
).pipe(
  Command.withSubcommands([
    loginCommand,
    logoutCommand,
    initCommand,
    statusCommand,
    buildsCommand,
    credentialsCommand,
    envCommand,
  ]),
);

const cli = Command.run(command, {
  name: "better-update",
  version: "0.1.0",
});

cli(process.argv).pipe(
  Effect.provide(ConfigStoreLive),
  Effect.provide(AuthStoreLive),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
