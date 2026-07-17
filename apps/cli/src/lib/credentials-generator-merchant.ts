// @expo/apple-utils is ncc-bundled CJS; the entity managers + enums are read off
// the default import (see credentials-generator-apple-id.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import type { RequestContext } from "@expo/apple-utils";

import { wrap } from "./credentials-generator-apple";

/**
 * Enable the Apple Pay capability on an App ID, registering the App ID first if
 * it does not exist yet. Returns once the capability is on. Works over both a
 * token and a cookie `RequestContext` (apple-utils routes both through its
 * provisioning client).
 */
const enableApplePayCapability = (ctx: RequestContext, bundleIdentifier: string) =>
  Effect.gen(function* () {
    const existing = yield* wrap("apple-find-bundle-id", async () =>
      AppleUtils.BundleId.findAsync(ctx, { identifier: bundleIdentifier }),
    );
    const bundle =
      existing ??
      (yield* wrap("apple-create-bundle-id", async () =>
        AppleUtils.BundleId.createAsync(ctx, {
          identifier: bundleIdentifier,
          name: bundleIdentifier,
          platform: AppleUtils.BundleIdPlatform.IOS,
        }),
      ));
    yield* wrap("apple-enable-apple-pay", async () =>
      bundle.updateBundleIdCapabilityAsync({
        capabilityType: AppleUtils.CapabilityType.APPLE_PAY,
        option: AppleUtils.CapabilityTypeOption.ON,
      }),
    );
  });

export interface RegisterMerchantIdInput {
  readonly context: RequestContext;
  /** The `merchant.*` identifier to register. */
  readonly identifier: string;
  readonly name: string;
  /** When set, also turns on the Apple Pay capability for this App ID. */
  readonly bundleIdentifier?: string;
}

export interface RegisteredMerchantId {
  readonly developerPortalIdentifier: string;
  readonly identifier: string;
  readonly name: string;
  readonly capabilityEnabledForBundleId: string | undefined;
}

/**
 * Register an Apple Pay Merchant ID (`merchant.*`), optionally enabling the
 * Apple Pay capability on an App ID. Context-agnostic: over a headless token
 * context apple-utils targets the public ASC REST API (`POST /v1/merchantIds`,
 * attributes `identifier` + `name` only); over an Apple ID cookie context it
 * proxies the same models through the Developer Portal. This is the one piece
 * of Apple Pay onboarding those APIs support — the payment-processing
 * certificate itself is still created out-of-band (usually by the PSP) and
 * uploaded via `credentials upload --type apple-pay-certificate`.
 */
export const registerMerchantId = (input: RegisterMerchantIdInput) =>
  Effect.gen(function* () {
    const merchant = yield* wrap("apple-create-merchant-id", async () =>
      AppleUtils.MerchantId.createAsync(input.context, {
        identifier: input.identifier,
        name: input.name,
      }),
    );
    if (input.bundleIdentifier !== undefined && input.bundleIdentifier.length > 0) {
      yield* enableApplePayCapability(input.context, input.bundleIdentifier);
    }
    return {
      developerPortalIdentifier: merchant.id,
      identifier: input.identifier,
      name: input.name,
      capabilityEnabledForBundleId: input.bundleIdentifier,
    } satisfies RegisteredMerchantId;
  });
