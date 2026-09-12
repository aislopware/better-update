import { compact } from "@better-update/type-guards";
import { Config, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { createSandboxTester } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

const SANDBOX_PASSWORD_ENV = "BETTER_UPDATE_SANDBOX_PASSWORD";

export const sandboxCreateCommand = Command.make(
  "create",
  {
    email: Flag.String("email").pipe(Flag.withDescription("Sandbox Apple ID email")),
    password: Flag.String("password").pipe(
      Flag.withDescription(
        `Account password (or set ${SANDBOX_PASSWORD_ENV} to avoid shell history)`,
      ),
      Flag.withFallbackConfig(Config.String(SANDBOX_PASSWORD_ENV)),
    ),
    "first-name": Flag.String("first-name").pipe(Flag.withDescription("First name")),
    "last-name": Flag.String("last-name").pipe(Flag.withDescription("Last name")),
    "secret-question": Flag.String("secret-question").pipe(
      Flag.withDescription("Security question"),
      optionalFlag,
    ),
    "secret-answer": Flag.String("secret-answer").pipe(
      Flag.withDescription("Security answer"),
      optionalFlag,
    ),
    "birth-date": Flag.String("birth-date").pipe(
      Flag.withDescription("Birth date, YYYY-MM-DD"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const email = args.email.trim();
      const firstName = args["first-name"].trim();
      const lastName = args["last-name"].trim();
      const { password } = args;
      const { ctx } = yield* openCookieContext;
      const tester = yield* createSandboxTester(ctx, {
        email,
        password,
        firstName,
        lastName,
        ...compact({
          secretQuestion: args["secret-question"],
          secretAnswer: args["secret-answer"],
          birthDate: args["birth-date"],
        }),
      });
      yield* printHuman(`Created sandbox tester ${tester.email} (${tester.id}).`);
      return tester;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Create an App Store sandbox tester (Apple ID login)"));
