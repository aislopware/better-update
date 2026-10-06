/**
 * Developer ID provisioning profiles for a build. A bundle that claims an
 * entitlement only a profile authorizes (iCloud, push, associated domains,
 * keychain sharing, …) is killed at launch without one, so the build finds the
 * stored `DEVELOPER_ID` profile for its bundle id and signing certificate —
 * or has Apple create one — and checks that it actually grants what the
 * bundle claims before signing with it.
 */
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { ascKeyRequestContext } from "../lib/credentials-generator-apple";
import { generateAndUploadDeveloperIdProfile } from "../lib/credentials-generator-macos-profile";
import { ProvisioningError } from "../lib/exit-codes";
import { collectNestedCode, readBundleInfo } from "../lib/macos-code-discovery";
import { entitlementsNeedingProfile, readEntitlements } from "../lib/macos-code-inspect";
import { printHuman } from "../lib/output";
import { parsePlistXml } from "../lib/plist";
import { profilePlistXml } from "../lib/provisioning-profile-plist";

import type { EmbeddedProfile } from "../lib/macos-signing";
import type { PlistObject } from "../lib/plist";
import type { ApiClient } from "../services/api-client";
import type { DeveloperIdIdentity } from "./macos-signing-identity";

/** A bundle id and the entitlements it claims that need a profile. */
export interface ProfileNeed {
  readonly bundleId: string;
  readonly entitlements: readonly string[];
}

export interface ResolvedProfile extends EmbeddedProfile {
  readonly name: string;
  readonly uuid: string;
}

const hasEmbeddedProfile = (bundlePath: string) =>
  Effect.promise(async () => {
    try {
      await access(path.join(bundlePath, "Contents", "embedded.provisionprofile"));
      return true;
    } catch {
      return false;
    }
  });

/**
 * Profile needs of a built `.app` — the app and every executable bundle in it
 * — that do not carry a profile already. `outerEntitlements` stands in for the
 * app's own when a re-sign is about to replace them.
 */
export const appProfileNeeds = (appPath: string, outerEntitlements?: PlistObject) =>
  Effect.gen(function* () {
    const nested = yield* collectNestedCode(appPath);
    const bundles = [
      appPath,
      ...nested
        .filter((item) => item.kind === "bundle" && !item.path.toLowerCase().endsWith(".framework"))
        .map((item) => item.path),
    ];
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(iterable, f) is not Array.prototype.forEach
    const needs = yield* Effect.forEach(bundles, (bundlePath) =>
      Effect.gen(function* () {
        const { bundleId } = yield* readBundleInfo(bundlePath);
        const claimed =
          bundlePath === appPath && outerEntitlements !== undefined
            ? outerEntitlements
            : yield* readEntitlements(bundlePath);
        const entitlements = entitlementsNeedingProfile(claimed);
        return bundleId === undefined ||
          entitlements.length === 0 ||
          (yield* hasEmbeddedProfile(bundlePath))
          ? []
          : [{ bundleId, entitlements } satisfies ProfileNeed];
      }),
    );
    return needs.flat();
  });

interface DecodedProfile {
  readonly uuid: string;
  readonly name: string;
  readonly teamId: string;
  readonly entitlements: Readonly<Record<string, unknown>>;
}

const decodeProfile = (profileBytes: Uint8Array) =>
  Effect.gen(function* () {
    const xml = profilePlistXml(profileBytes);
    if (xml === undefined) {
      return yield* new ProvisioningError({
        message: "The provisioning profile holds no property list.",
      });
    }
    const plist = parsePlistXml(xml);
    const teams: unknown = plist["TeamIdentifier"];
    const teamId: unknown = Array.isArray(teams) ? teams[0] : undefined;
    const uuid = plist["UUID"];
    const name = plist["Name"];
    const entitlements = asRecord(plist["Entitlements"]);
    if (
      typeof uuid !== "string" ||
      typeof name !== "string" ||
      typeof teamId !== "string" ||
      entitlements === undefined
    ) {
      return yield* new ProvisioningError({
        message: "The provisioning profile lacks a UUID, name, team or entitlements.",
      });
    }
    return {
      uuid,
      name,
      teamId,
      entitlements,
    } satisfies DecodedProfile;
  });

/** The claimed entitlements a profile does not grant. */
export const ungrantedEntitlements = (
  need: ProfileNeed,
  granted: Readonly<Record<string, unknown>>,
): readonly string[] => need.entitlements.filter((key) => !(key in granted));

/** Decode a profile and write it to `workDir` for signing to embed. */
const materializeProfile = (workDir: string, bundleId: string, profileBase64: string) =>
  Effect.gen(function* () {
    const bytes = fromBase64(profileBase64);
    const decoded = yield* decodeProfile(bytes);
    const profilePath = path.join(workDir, `${bundleId}.provisionprofile`);
    yield* Effect.promise(async () => writeFile(profilePath, bytes));
    return { ...decoded, path: profilePath } satisfies ResolvedProfile;
  });

/** Days a stored profile must still be valid for a build to rely on it. */
const MIN_VALID_DAYS = 7;

const storedProfile = (api: ApiClient, need: ProfileNeed, certificateId: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.appleProvisioningProfiles.list({
      query: { bundleIdentifier: need.bundleId, distributionType: "DEVELOPER_ID" },
    });
    const cutoff = Date.now() + MIN_VALID_DAYS * 86_400_000;
    const usable = items.find(
      (item) =>
        item.appleDistributionCertificateId === certificateId &&
        (item.validUntil === null || Date.parse(item.validUntil) > cutoff),
    );
    if (usable === undefined) {
      return undefined;
    }
    const { profileBase64 } = yield* api.appleProvisioningProfiles.download({
      params: { id: usable.id },
    });
    return profileBase64;
  });

export interface ResolveDeveloperIdProfilesOptions<KeyError, KeyServices> {
  readonly needs: readonly ProfileNeed[];
  readonly identity: DeveloperIdIdentity;
  readonly workDir: string;
  /** The ASC API key that may create a missing profile; asked for only when one is missing. */
  readonly ascApiKeyId: Effect.Effect<string, KeyError, KeyServices>;
}

/**
 * A profile for every need, keyed by bundle id: the stored one when it is for
 * this certificate, valid for another week and grants every claimed
 * entitlement; otherwise a new one from Apple (which reflects the App ID's
 * capabilities as they are now). Fails naming the capabilities to enable when
 * even a fresh profile does not grant what the bundle claims.
 */
export const resolveDeveloperIdProfiles = <KeyError, KeyServices>(
  api: ApiClient,
  options: ResolveDeveloperIdProfilesOptions<KeyError, KeyServices>,
) =>
  Effect.gen(function* () {
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(iterable, f) is not Array.prototype.forEach
    const resolved = yield* Effect.forEach(options.needs, (need) =>
      Effect.gen(function* () {
        const stored = yield* storedProfile(api, need, options.identity.certificateId);
        const storedProfileFile =
          stored === undefined
            ? undefined
            : yield* materializeProfile(options.workDir, need.bundleId, stored);
        if (
          storedProfileFile !== undefined &&
          ungrantedEntitlements(need, storedProfileFile.entitlements).length === 0
        ) {
          return [need.bundleId, storedProfileFile] as const;
        }
        yield* printHuman(
          `Creating a Developer ID provisioning profile for ${need.bundleId} (it claims ${need.entitlements.join(", ")})...`,
        );
        const context = yield* ascKeyRequestContext(api, yield* options.ascApiKeyId);
        const generated = yield* generateAndUploadDeveloperIdProfile(api, {
          context,
          certificateId: options.identity.certificateId,
          bundleIdentifier: need.bundleId,
        });
        const fresh = yield* materializeProfile(
          options.workDir,
          need.bundleId,
          generated.profileBase64,
        );
        const missing = ungrantedEntitlements(need, fresh.entitlements);
        if (missing.length > 0) {
          return yield* new ProvisioningError({
            message: `The App ID ${need.bundleId} does not have the capabilities for ${missing.join(", ")}, so no profile can grant them. Enable them (\`better-update credentials capability enable --identifier ${need.bundleId} --capability <TYPE>\`, or in the Apple Developer portal), then build again.`,
          });
        }
        return [need.bundleId, fresh] as const;
      }),
    );
    return new Map<string, ResolvedProfile>(resolved);
  });
