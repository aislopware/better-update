import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { registerMerchantIdViaAppleId } from "../../lib/credentials-generator-merchant";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { AppleAuth } from "../../services/apple-auth";

const MERCHANT_ID_PATTERN = /^merchant\.[A-Za-z0-9][A-Za-z0-9.-]*$/u;

const MERCHANT_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  AppleIdGenerateFailedError: 6,
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

interface MerchantIdArgs {
  readonly identifier: string;
  readonly name?: string | undefined;
  readonly "bundle-identifier"?: string | undefined;
}

export const merchantIdCommand = defineCommand({
  meta: {
    name: "merchant-id",
    description:
      "Register an Apple Pay Merchant ID (merchant.*) on the Developer Portal via Apple ID login, optionally turning on Apple Pay for an App ID. The payment-processing certificate itself is uploaded separately with `credentials upload --type apple-pay-certificate`.",
  },
  args: {
    identifier: { type: "string", required: true, description: "Merchant ID (merchant.*)" },
    name: { type: "string", description: "Display name (defaults to the identifier)" },
    "bundle-identifier": {
      type: "string",
      description: "App ID to enable the Apple Pay capability on",
    },
  },
  run: async ({ args }: { readonly args: MerchantIdArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const identifier = args.identifier.trim();
        if (!MERCHANT_ID_PATTERN.test(identifier)) {
          return yield* new CredentialValidationError({
            message: `Merchant ID "${identifier}" must look like merchant.com.example.`,
          });
        }
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn();
        yield* printHuman("Registering Apple Pay Merchant ID via your Apple ID...");
        const created = yield* registerMerchantIdViaAppleId({
          context: auth.buildRequestContext(session),
          identifier,
          name: args.name ?? identifier,
          ...compact({ bundleIdentifier: args["bundle-identifier"] }),
        });
        yield* printHuman("Merchant ID registered.");
        yield* printHumanKeyValue([
          ["Merchant ID", created.identifier],
          ["Name", created.name],
          ["Apple identifier", created.developerPortalIdentifier],
          ["Apple Pay enabled on", created.capabilityEnabledForBundleId ?? "-"],
        ]);
        return created;
      }),
      { exits: MERCHANT_EXIT_EXTRAS, json: "value" },
    ),
});
