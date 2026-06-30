import AppleUtils from "@expo/apple-utils";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  coerceEnum,
  openAscContext,
} from "../../../application/app-store-connect";
import { enableCapability, resolveBundleId } from "../../../application/apple-signing-inventory";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

interface CapabilityEnableArgs extends AscAuthArgs {
  readonly "bundle-id"?: string | undefined;
  readonly identifier?: string | undefined;
  readonly capability: string;
}

export const capabilityEnableCommand = defineCommand({
  meta: {
    name: "enable",
    description: "Enable a capability on an App ID (turns it ON; CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
    "bundle-id": { type: "string", description: "App ID's ASC id" },
    identifier: { type: "string", description: "Bundle identifier (e.g. com.acme.app)" },
    capability: {
      type: "string",
      required: true,
      description: "Capability type, e.g. PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS, ICLOUD",
    },
  },
  run: async ({ args }: { readonly args: CapabilityEnableArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const capabilityType = yield* coerceEnum<AppleUtils.CapabilityType>(
          AppleUtils.CapabilityType,
          args.capability.toUpperCase(),
          "--capability",
        );
        const session = yield* openAscContext(args);
        const bundleId = yield* resolveBundleId(session.ctx, {
          id: args["bundle-id"],
          identifier: args.identifier,
        });
        const result = yield* enableCapability(bundleId, capabilityType);
        yield* printHuman(`Enabled ${result.capabilityType} on App ID ${result.id}.`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
