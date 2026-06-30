import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { listCapabilities, resolveBundleId } from "../../../application/apple-signing-inventory";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

interface CapabilityListArgs extends AscAuthArgs {
  readonly "bundle-id"?: string | undefined;
  readonly identifier?: string | undefined;
}

export const capabilityListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the capabilities enabled on an App ID (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
    "bundle-id": { type: "string", description: "App ID's ASC id" },
    identifier: { type: "string", description: "Bundle identifier (e.g. com.acme.app)" },
  },
  run: async ({ args }: { readonly args: CapabilityListArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
