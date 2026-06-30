import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { APP_STORE_EXIT_EXTRAS } from "../../../application/app-store-connect";
import { createSandboxTester } from "../../../application/apple-sandbox";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

const SANDBOX_PASSWORD_ENV = "BETTER_UPDATE_SANDBOX_PASSWORD";

interface SandboxCreateArgs {
  readonly email?: string | undefined;
  readonly password?: string | undefined;
  readonly "first-name"?: string | undefined;
  readonly "last-name"?: string | undefined;
  readonly "secret-question"?: string | undefined;
  readonly "secret-answer"?: string | undefined;
  readonly "birth-date"?: string | undefined;
}

export const sandboxCreateCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create an App Store sandbox tester (Apple ID login)",
  },
  args: {
    email: { type: "string", description: "Sandbox Apple ID email (required; must be unused)" },
    password: {
      type: "string",
      description: `Account password (or set ${SANDBOX_PASSWORD_ENV} to avoid shell history)`,
    },
    "first-name": { type: "string", description: "First name (required)" },
    "last-name": { type: "string", description: "Last name (required)" },
    "secret-question": { type: "string", description: "Security question" },
    "secret-answer": { type: "string", description: "Security answer" },
    "birth-date": { type: "string", description: "Birth date, YYYY-MM-DD" },
  },
  run: async ({ args }: { readonly args: SandboxCreateArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const email = args.email?.trim();
        const firstName = args["first-name"]?.trim();
        const lastName = args["last-name"]?.trim();
        const password = args.password ?? process.env[SANDBOX_PASSWORD_ENV];
        if (email === undefined || email.length === 0) {
          return yield* new InvalidArgumentError({ message: "--email is required." });
        }
        if (firstName === undefined || firstName.length === 0) {
          return yield* new InvalidArgumentError({ message: "--first-name is required." });
        }
        if (lastName === undefined || lastName.length === 0) {
          return yield* new InvalidArgumentError({ message: "--last-name is required." });
        }
        if (password === undefined || password.length === 0) {
          return yield* new InvalidArgumentError({
            message: `A password is required: pass --password or set ${SANDBOX_PASSWORD_ENV}.`,
          });
        }
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
