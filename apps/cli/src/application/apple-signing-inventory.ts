/**
 * App Store Connect **signing inventory** reads on the headless ASC
 * (`@expo/apple-utils`) entity layer: certificates, App IDs (bundle ids),
 * provisioning profiles, and App ID capabilities. Backs the Token/CI-safe
 * additions to the `credentials` group (`certificate list`, `bundle-id list`,
 * `profile list`, `capability list/enable`). All account-scoped — no app id.
 */
import { toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";

/** A signing certificate projected to the fields the CLI surfaces. */
export interface CertificateView {
  readonly id: string;
  readonly name: string;
  readonly certificateType: string;
  readonly serialNumber: string;
  readonly platform: string;
  readonly expirationDate: string;
  readonly status: string;
}

const toCertificateView = (certificate: AppleUtils.Certificate): CertificateView => ({
  id: certificate.id,
  name: certificate.attributes.name,
  certificateType: certificate.attributes.certificateType,
  serialNumber: certificate.attributes.serialNumber,
  platform: certificate.attributes.platform,
  expirationDate: certificate.attributes.expirationDate,
  status: certificate.attributes.status,
});

/** List the team's signing certificates. */
export const listCertificates = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-certificates", async () => AppleUtils.Certificate.getAsync(ctx)).pipe(
    Effect.map((certificates) => certificates.map(toCertificateView)),
  );

/** An App ID (bundle id) projected to the fields the CLI surfaces. */
export interface BundleIdView {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly platform: string;
  readonly seedId: string;
}

const toBundleIdView = (bundleId: AppleUtils.BundleId): BundleIdView => ({
  id: bundleId.id,
  identifier: bundleId.attributes.identifier,
  name: bundleId.attributes.name,
  platform: bundleId.attributes.platform,
  seedId: bundleId.attributes.seedId,
});

/** List the team's registered App IDs. */
export const listBundleIds = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-bundle-ids", async () => AppleUtils.BundleId.getAsync(ctx)).pipe(
    Effect.map((bundleIds) => bundleIds.map(toBundleIdView)),
  );

/** A provisioning profile projected to the fields the CLI surfaces. */
export interface ProfileView {
  readonly id: string;
  readonly name: string;
  readonly profileType: string;
  readonly profileState: string;
  readonly uuid: string;
  readonly platform: string;
  readonly expirationDate: string;
}

const toProfileView = (profile: AppleUtils.Profile): ProfileView => ({
  id: profile.id,
  name: profile.attributes.name,
  profileType: profile.attributes.profileType,
  profileState: profile.attributes.profileState,
  uuid: profile.attributes.uuid,
  platform: profile.attributes.platform,
  expirationDate: profile.attributes.expirationDate,
});

/** List the team's provisioning profiles. */
export const listProfiles = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-profiles", async () => AppleUtils.Profile.getAsync(ctx)).pipe(
    Effect.map((profiles) => profiles.map(toProfileView)),
  );

/** Resolve a `BundleId` entity from an explicit ASC id or a bundle identifier. */
export const resolveBundleId = (
  ctx: AppleUtils.RequestContext,
  selector: { readonly id: string | undefined; readonly identifier: string | undefined },
) =>
  Effect.gen(function* () {
    if (selector.id !== undefined) {
      const { id } = selector;
      return yield* wrapConnect("apple-get-bundle-id", async () =>
        AppleUtils.BundleId.infoAsync(ctx, { id }),
      );
    }
    const { identifier } = selector;
    if (identifier === undefined) {
      return yield* new AppStoreError({ message: "Pass --bundle-id <id> or --identifier <id>." });
    }
    const bundleId = yield* wrapConnect("apple-find-bundle-id", async () =>
      AppleUtils.BundleId.findAsync(ctx, { identifier }),
    );
    if (bundleId === null) {
      return yield* new AppStoreError({
        message: `No App ID found for identifier ${identifier}.`,
      });
    }
    return bundleId;
  });

/** An App ID capability projected to the fields the CLI surfaces. */
export interface CapabilityView {
  readonly id: string;
  readonly capabilityType: string | null;
  readonly settingsCount: number;
}

const toCapabilityView = (capability: AppleUtils.BundleIdCapability): CapabilityView => ({
  id: capability.id,
  capabilityType: toDbNull(capability.attributes.capabilityType),
  settingsCount: (capability.attributes.settings ?? []).length,
});

/** List the capabilities enabled on an App ID. */
export const listCapabilities = (bundleId: AppleUtils.BundleId) =>
  wrapConnect("apple-list-capabilities", async () => bundleId.getBundleIdCapabilitiesAsync()).pipe(
    Effect.map((capabilities) => capabilities.map(toCapabilityView)),
  );

/**
 * Enable a capability on an App ID (turns it `ON`). Capabilities with per-type
 * option variants (Data Protection, iCloud, Sign In with Apple, Push) are enabled
 * with their default option.
 */
export const enableCapability = (
  bundleId: AppleUtils.BundleId,
  capabilityType: AppleUtils.CapabilityType,
) =>
  wrapConnect("apple-enable-capability", async () =>
    bundleId.updateBundleIdCapabilityAsync({
      capabilityType,
      option: AppleUtils.CapabilityTypeOption.ON,
    }),
  ).pipe(Effect.map((updated) => ({ id: updated.id, capabilityType })));
