import { Command as CliCommand, Options } from "@effect/cli";
import { Cause, Effect, Exit } from "effect";

import { exitWith } from "../application/command-exit";
import { runLogin } from "../application/login";

const manualApiKey = Options.boolean("api-key");

const loginFailed = (cause: Cause.Cause<unknown>) => exitWith(1, Cause.pretty(cause));

export const loginCommand = CliCommand.make("login", { manualApiKey }, (opts) =>
  runLogin({ manualApiKey: opts.manualApiKey }).pipe(
    Effect.exit,
    Effect.flatMap((exit) => (Exit.isSuccess(exit) ? Effect.void : loginFailed(exit.cause))),
  ),
);
