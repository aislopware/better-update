/**
 * Developer ID provisioning profiles (App Store Connect `MAC_APP_DIRECT`). A
 * macOS app distributed outside the Mac App Store needs one only when it claims
 * an entitlement Apple must authorize — iCloud, push, associated domains,
 * keychain sharing, … — and then embeds it as
 * `Contents/embedded.provisionprofile`. Such a profile names the bundle id and
 * the Developer ID Application certificate, and no devices: it is valid on
 * every Mac.
 */
import { fromBase64, toBase64 } from "@better-update/encoding";
// @expo/apple-utils is ncc-bundled CJS; the entity managers + enums are read off the default import.
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { ascCertificateTypes } from "./apple-asc-certificate-types";
import {
  AppleIdGenerateFailedError,
  findAscCertificateId,
  findOrCreateBundleId,
  wrap,
} from "./credentials-generator-apple";
import { autoBindProjectId } from "./project-link";

import type { ApiClient } from "../services/api-client";

export interface GenerateDeveloperIdProfileInput {
  readonly context: AppleUtils.RequestContext;
  /** Vault row id of the Developer ID Application certificate the app is signed with. */
  readonly certificateId: string;
  readonly bundleIdentifier: string;
}

export interface GeneratedDeveloperIdProfile {
  readonly id: string;
  readonly bundleIdentifier: string;
  readonly profileName: string | null;
  readonly developerPortalIdentifier: string | null;
  readonly validUntil: string | null;
  /** Raw profile bytes (base64), so a build can embed it without a download. */
  readonly profileBase64: string;
}

/**
 * Create a `MAC_APP_DIRECT` profile for `bundleIdentifier` with the stored
 * certificate on Apple, and store it. A bundle id Apple does not know yet is
 * registered for macOS.
 */
export const generateAndUploadDeveloperIdProfile = (
  api: ApiClient,
  input: GenerateDeveloperIdProfileInput,
) =>
  Effect.gen(function* () {
    const { items } = yield* api.appleDistributionCertificates.list();
    const cert = items.find((item) => item.id === input.certificateId);
    if (cert?.certificateType !== "DEVELOPER_ID_APPLICATION") {
      return yield* new AppleIdGenerateFailedError({
        step: "load-distribution-certificate",
        message:
          cert === undefined
            ? `Certificate ${input.certificateId} not found`
            : `Certificate ${input.certificateId} is ${cert.certificateType}; a Developer ID profile needs a Developer ID Application certificate`,
      });
    }

    const [certAscId, bundleIdAscId] = yield* Effect.all(
      [
        findAscCertificateId(
          input.context,
          cert.serialNumber,
          ascCertificateTypes("DEVELOPER_ID_APPLICATION"),
        ),
        findOrCreateBundleId(
          input.context,
          input.bundleIdentifier,
          AppleUtils.BundleIdPlatform.MAC_OS,
        ),
      ],
      { concurrency: 2 },
    );

    const profile = yield* wrap("apple-create-profile", async () =>
      AppleUtils.Profile.createAsync(input.context, {
        bundleId: bundleIdAscId,
        certificates: [certAscId],
        devices: [],
        name: `${input.bundleIdentifier} DEVELOPER_ID ${String(Date.now())}`,
        profileType: AppleUtils.ProfileType.MAC_APP_DIRECT,
      }),
    );
    const { profileContent } = profile.attributes;
    if (profileContent === null) {
      return yield* new AppleIdGenerateFailedError({
        step: "extract-profile-content",
        message: "Apple returned a profile with no content (likely expired/invalid)",
      });
    }
    const profileBase64 = toBase64(fromBase64(profileContent));
    const created = yield* api.appleProvisioningProfiles.upload({
      payload: {
        profileBase64,
        appleDistributionCertificateId: input.certificateId,
        // Created here, so the CLI may recreate it when it no longer fits.
        isManaged: true,
        ...(yield* autoBindProjectId),
      },
    });
    return {
      id: created.id,
      bundleIdentifier: created.bundleIdentifier,
      profileName: created.profileName,
      developerPortalIdentifier: created.developerPortalIdentifier,
      validUntil: created.validUntil,
      profileBase64,
    } satisfies GeneratedDeveloperIdProfile;
  });
