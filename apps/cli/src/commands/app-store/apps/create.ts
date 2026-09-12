import { compact, toOptional } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { createApp } from "../../../application/app-store-apps";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const appsCreateCommand = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("App name as shown on the App Store")),
    "bundle-identifier": Flag.String("bundle-identifier").pipe(
      Flag.withDescription("Registered bundle id, e.g. com.acme.app"),
    ),
    sku: Flag.String("sku").pipe(
      Flag.withDescription("Unique SKU (defaults to the bundle id)"),
      optionalFlag,
    ),
    "primary-locale": Flag.String("primary-locale").pipe(
      Flag.withDescription("Primary locale (defaults to en-US)"),
      optionalFlag,
    ),
    "company-name": Flag.String("company-name").pipe(
      Flag.withDescription(
        "Seller/company name (defaults to your Apple team name; required for a brand-new org)",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const name = args.name.trim();
      const bundleIdentifier = args["bundle-identifier"].trim();
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Register a new App Store Connect app record (Apple ID login, App Manager role; bundle id must already be registered)",
  ),
);
