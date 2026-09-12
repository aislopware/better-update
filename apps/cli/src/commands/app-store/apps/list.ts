import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { listApps } from "../../../application/app-store-apps";
import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const appsListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const apps = yield* listApps(session.ctx);
      yield* printHumanList(
        ["Name", "Bundle id", "SKU", "Locale", "ID"],
        apps.map((app) => [app.name, app.bundleId, app.sku, app.primaryLocale, app.id]),
        "No apps found.",
      );
      return { items: apps };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List every app the App Store Connect API key can see (CI-safe)"));
