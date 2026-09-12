import { Command, Flag } from "effect/unstable/cli";

import { runLogin } from "../application/login";
import { runCommand } from "../lib/run-command";

export const loginCommand = Command.make(
  "login",
  {
    "api-key": Flag.Boolean("api-key").pipe(
      Flag.withDescription("Paste a session token manually instead of opening the browser"),
      Flag.withDefault(false),
    ),
  },
  (args) => runLogin({ manualApiKey: args["api-key"] }).pipe(runCommand()),
).pipe(Command.withDescription("Log in to better-update"));
