import { Effect } from "effect";

import { generateAndUploadProvisioningProfile } from "./credentials-generator";

import type { ApiClient } from "../services/api-client";

type DistributionType = "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";

export interface AutoProvisionExtensionProfileInput {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly ascApiKeyId: string;
  /** Backend row id of the distribution certificate that signs the main app. */
  readonly distributionCertificateId: string;
  /** Backend row id of the Apple team that owns the cert. */
  readonly appleTeamId: string;
}

export interface AutoProvisionedExtensionProfile {
  readonly bundleIdentifier: string;
  readonly profileBase64: string;
  readonly profileUuid: string;
  readonly profileName: string | null;
  /** Backend row id of the newly created AppleProvisioningProfile. */
  readonly appleProvisioningProfileId: string;
  /** Backend row id of the newly created IosBundleConfiguration binding. */
  readonly iosBundleConfigurationId: string;
}

/**
 * Mint a fresh provisioning profile for an extension bundle that has no
 * registered IosBundleConfiguration yet:
 *   1. Generate the profile via Apple ASC (reusing the main app's dist cert).
 *   2. Upload the .mobileprovision bytes to the backend so future resolves work.
 *   3. Create an IosBundleConfiguration binding so the new profile is wired up.
 *
 * Returns the profile bytes in-line so the build can install + sign immediately
 * without a follow-up resolve round-trip.
 */
export const autoProvisionExtensionProfile = (
  api: ApiClient,
  input: AutoProvisionExtensionProfileInput,
) =>
  Effect.gen(function* () {
    const generated = yield* generateAndUploadProvisioningProfile(api, {
      ascApiKeyId: input.ascApiKeyId,
      distributionCertificateId: input.distributionCertificateId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: input.distributionType,
    });

    const binding = yield* api.iosBundleConfigurations.create({
      path: { projectId: input.projectId },
      payload: {
        bundleIdentifier: input.bundleIdentifier,
        distributionType: input.distributionType,
        appleTeamId: input.appleTeamId,
        appleDistributionCertificateId: input.distributionCertificateId,
        appleProvisioningProfileId: generated.id,
        ascApiKeyId: input.ascApiKeyId,
      },
    });

    return {
      bundleIdentifier: input.bundleIdentifier,
      profileBase64: generated.profileBase64,
      // developerPortalIdentifier is `string | null` in the schema but is always
      // populated when Apple ASC successfully creates a profile; fall back to
      // the bundle id for filename safety to satisfy the no-?? fallback rule.
      profileUuid: generated.developerPortalIdentifier ?? input.bundleIdentifier,
      profileName: generated.profileName,
      appleProvisioningProfileId: generated.id,
      iosBundleConfigurationId: binding.id,
    } satisfies AutoProvisionedExtensionProfile;
  });
