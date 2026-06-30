import { compact, toOptional } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { createApp } from "../../../application/app-store-apps";
import { APP_STORE_EXIT_EXTRAS } from "../../../application/app-store-connect";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

interface AppsCreateArgs {
  readonly name?: string | undefined;
  readonly "bundle-identifier"?: string | undefined;
  readonly sku?: string | undefined;
  readonly "primary-locale"?: string | undefined;
  readonly "company-name"?: string | undefined;
}

export const appsCreateCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Register a new App Store Connect app record (Apple ID login, App Manager role; bundle id must already be registered)",
  },
  args: {
    name: { type: "string", description: "App name as shown on the App Store (required)" },
    "bundle-identifier": {
      type: "string",
      description: "Registered bundle id, e.g. com.acme.app (required)",
    },
    sku: { type: "string", description: "Unique SKU (defaults to the bundle id)" },
    "primary-locale": { type: "string", description: "Primary locale (defaults to en-US)" },
    "company-name": {
      type: "string",
      description:
        "Seller/company name (defaults to your Apple team name; required for a brand-new org)",
    },
  },
  run: async ({ args }: { readonly args: AppsCreateArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const name = args.name?.trim();
        if (name === undefined || name.length === 0) {
          return yield* new InvalidArgumentError({ message: "--name is required." });
        }
        const bundleIdentifier = args["bundle-identifier"]?.trim();
        if (bundleIdentifier === undefined || bundleIdentifier.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--bundle-identifier is required (e.g. com.acme.app).",
          });
        }
        const { ctx, session } = yield* openCookieContext;
        const app = yield* createApp(ctx, {
          name,
          bundleIdentifier,
          ...compact({
            sku: args.sku,
            primaryLocale: args["primary-locale"],
            companyName: args["company-name"] ?? toOptional(session.teamName),
          }),
        });
        yield* printHuman(`Created App Store Connect app "${app.name}".`);
        yield* printHumanKeyValue([
          ["ID", app.id],
          ["Bundle id", app.bundleId],
          ["SKU", app.sku],
          ["Locale", app.primaryLocale],
        ]);
        return app;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
