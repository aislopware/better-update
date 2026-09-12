import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, coerceEnum, openAscContext } from "../../../application/app-store-connect";
import { enableCapability, resolveBundleId } from "../../../application/apple-signing-inventory";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const capabilityEnableCommand = Command.make(
  "enable",
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
    capability: Flag.String("capability").pipe(
      Flag.withDescription("Capability type, e.g. PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS, ICLOUD"),
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Enable a capability on an App ID (turns it ON; CI-safe)"));
