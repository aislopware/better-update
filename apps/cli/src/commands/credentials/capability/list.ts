import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { listCapabilities, resolveBundleId } from "../../../application/apple-signing-inventory";
import { printHumanList } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const capabilityListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
    "bundle-id": Flag.String("bundle-id").pipe(
      Flag.withDescription("App ID's ASC id"),
      optionalFlag,
    ),
    identifier: Flag.String("identifier").pipe(
      Flag.withDescription("Bundle identifier (e.g. com.acme.app)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const bundleId = yield* resolveBundleId(session.ctx, {
        id: args["bundle-id"],
        identifier: args.identifier,
      });
      const capabilities = yield* listCapabilities(bundleId);
      yield* printHumanList(
        ["Capability", "Settings", "ID"],
        capabilities.map((capability) => [
          capability.capabilityType ?? "—",
          String(capability.settingsCount),
          capability.id,
        ]),
        "No capabilities enabled.",
      );
      return { bundleId: bundleId.id, items: capabilities };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the capabilities enabled on an App ID (CI-safe)"));
