import { Data, Effect } from "effect";

import { toDbNull } from "../lib/nullable";
import {
  getPlistBoolean,
  getPlistDateString,
  getPlistObject,
  getPlistString,
  getPlistStringArray,
  parsePlistXml,
} from "../lib/plist";
import { APPLE_TEAM_ID_PATTERN } from "./apple-identifiers";

import type { PlistObject } from "../lib/plist";
import type { ProfileDistributionType } from "../models";

export class InvalidProvisioningProfile extends Data.TaggedError("InvalidProvisioningProfile")<{
  readonly message: string;
}> {}

export interface ParsedProvisioningProfile {
  readonly bundleIdentifier: string;
  readonly distributionType: ProfileDistributionType;
  readonly appleTeamId: string;
  readonly teamName: string | null;
  readonly developerPortalIdentifier: string | null;
  readonly profileName: string | null;
  readonly validUntil: string | null;
  readonly certificateSerialNumbers: readonly string[];
}

const PLIST_START = "<?xml";
const PLIST_END = "</plist>";

const extractPlist = (bytes: Uint8Array): string | null => {
  // A single-byte decoding keeps string offsets equal to byte offsets.
  const text = new TextDecoder("latin1").decode(bytes);
  const start = text.indexOf(PLIST_START);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf(PLIST_END, start);
  if (end === -1) {
    return null;
  }
  // The plist itself is UTF-8: a profile name need not be ASCII.
  return new TextDecoder().decode(bytes.subarray(start, end + PLIST_END.length));
};

// iOS profiles name the app id `application-identifier`; macOS ones
// `com.apple.application-identifier`.
const readApplicationIdentifier = (plist: PlistObject): string | null => {
  const entitlements = getPlistObject(plist, "Entitlements") ?? plist;
  return (
    getPlistString(entitlements, "application-identifier") ??
    getPlistString(entitlements, "com.apple.application-identifier")
  );
};

const isMacProfile = (plist: PlistObject): boolean =>
  getPlistStringArray(plist, "Platform").includes("OSX");

const hasProvisionedDevices = (plist: PlistObject): boolean =>
  getPlistStringArray(plist, "ProvisionedDevices").length > 0;

const hasGetTaskAllow = (plist: PlistObject): boolean => {
  const entitlements = getPlistObject(plist, "Entitlements");
  return (
    getPlistBoolean(plist, "get-task-allow") ||
    (entitlements === null ? false : getPlistBoolean(entitlements, "get-task-allow"))
  );
};

const inferDistributionType = (plist: PlistObject): ProfileDistributionType => {
  // A profile valid on every device is in-house on iOS and Developer ID on
  // macOS (App Store Connect `IOS_APP_INHOUSE` / `MAC_APP_DIRECT`).
  if (getPlistBoolean(plist, "ProvisionsAllDevices")) {
    return isMacProfile(plist) ? "DEVELOPER_ID" : "ENTERPRISE";
  }
  const hasDevices = hasProvisionedDevices(plist);

  if (hasDevices && hasGetTaskAllow(plist)) {
    return "DEVELOPMENT";
  }
  if (hasDevices) {
    return "AD_HOC";
  }
  return "APP_STORE";
};

const malformedPlist = () =>
  new InvalidProvisioningProfile({
    message: "Embedded provisioning profile plist is malformed",
  });

const parseEmbeddedPlist = (plistXml: string) => {
  const parsed = parsePlistXml(plistXml);
  return parsed === null ? Effect.fail(malformedPlist()) : Effect.succeed(parsed);
};

export const parseProvisioningProfile = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const plistXml = extractPlist(bytes);
    if (plistXml === null) {
      return yield* new InvalidProvisioningProfile({
        message: "Could not find embedded plist in .mobileprovision",
      });
    }

    const plist = yield* parseEmbeddedPlist(plistXml);
    const teamSingle = getPlistString(plist, "TeamIdentifier");
    const teamArray = getPlistStringArray(plist, "TeamIdentifier");
    const appleTeamId = toDbNull(teamSingle ?? teamArray[0]);
    if (appleTeamId === null || !APPLE_TEAM_ID_PATTERN.test(appleTeamId)) {
      return yield* new InvalidProvisioningProfile({
        message: "TeamIdentifier missing or malformed",
      });
    }

    const appIdentifier = readApplicationIdentifier(plist);
    if (appIdentifier === null) {
      return yield* new InvalidProvisioningProfile({
        message: "application-identifier missing from profile plist",
      });
    }
    const bundlePrefix = `${appleTeamId}.`;
    const bundleIdentifier = appIdentifier.startsWith(bundlePrefix)
      ? appIdentifier.slice(bundlePrefix.length)
      : appIdentifier;
    if (bundleIdentifier.length === 0) {
      return yield* new InvalidProvisioningProfile({
        message: "Bundle identifier is empty",
      });
    }

    const parsed: ParsedProvisioningProfile = {
      bundleIdentifier,
      distributionType: inferDistributionType(plist),
      appleTeamId,
      teamName: getPlistString(plist, "TeamName"),
      developerPortalIdentifier: getPlistString(plist, "UUID"),
      profileName: getPlistString(plist, "Name"),
      validUntil: getPlistDateString(plist, "ExpirationDate"),
      certificateSerialNumbers: getPlistStringArray(plist, "DeveloperCertificates"),
    };
    return parsed;
  });
