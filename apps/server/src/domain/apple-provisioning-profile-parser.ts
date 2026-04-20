import { Data, Effect } from "effect";

import { toDbNull } from "../lib/nullable";

import type { DistributionType } from "../models";

export class InvalidProvisioningProfile extends Data.TaggedError("InvalidProvisioningProfile")<{
  readonly message: string;
}> {}

export interface ParsedProvisioningProfile {
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly appleTeamId: string;
  readonly developerPortalIdentifier: string | null;
  readonly profileName: string | null;
  readonly validUntil: string | null;
  readonly certificateSerialNumbers: readonly string[];
}

const PLIST_START = "<?xml";
const PLIST_END = "</plist>";

const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u;

const matchStringTag = (plist: string, key: string): string | null => {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, "u");
  const match = pattern.exec(plist);
  return match === null ? null : toDbNull(match[1]);
};

const matchDateTag = (plist: string, key: string): string | null => {
  const pattern = new RegExp(`<key>${key}</key>\\s*<date>([^<]+)</date>`, "u");
  const match = pattern.exec(plist);
  return match === null ? null : toDbNull(match[1]);
};

const matchArrayBlock = (plist: string, key: string): string | null => {
  const pattern = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, "u");
  const match = pattern.exec(plist);
  return match === null ? null : toDbNull(match[1]);
};

const matchBoolTag = (plist: string, key: string): boolean => {
  const pattern = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`, "u");
  const match = pattern.exec(plist);
  return match?.[1] === "true";
};

const extractPlist = (bytes: Uint8Array): string | null => {
  const text = new TextDecoder("latin1").decode(bytes);
  const start = text.indexOf(PLIST_START);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf(PLIST_END, start);
  if (end === -1) {
    return null;
  }
  return text.slice(start, end + PLIST_END.length);
};

const extractStringArray = (plist: string, key: string): readonly string[] => {
  const body = matchArrayBlock(plist, key);
  if (body === null) {
    return [];
  }
  const matches = [...body.matchAll(/<string>([^<]+)<\/string>/gu)];
  return matches.flatMap((match) => {
    const [, value] = match;
    if (value === undefined) {
      return [];
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
};

const inferDistributionType = (plist: string): DistributionType => {
  if (matchBoolTag(plist, "ProvisionsAllDevices")) {
    return "ENTERPRISE";
  }
  const provisionedBody = matchArrayBlock(plist, "ProvisionedDevices");
  const hasDevices = provisionedBody !== null && /<string>/u.test(provisionedBody);
  const hasGetTaskAllow = matchBoolTag(plist, "get-task-allow");

  if (hasDevices && hasGetTaskAllow) {
    return "DEVELOPMENT";
  }
  if (hasDevices) {
    return "AD_HOC";
  }
  return "APP_STORE";
};

export const parseProvisioningProfile = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const plist = extractPlist(bytes);
    if (plist === null) {
      return yield* Effect.fail(
        new InvalidProvisioningProfile({
          message: "Could not find embedded plist in .mobileprovision",
        }),
      );
    }

    const teamSingle = matchStringTag(plist, "TeamIdentifier");
    const teamArray = extractStringArray(plist, "TeamIdentifier");
    const appleTeamId = toDbNull(teamSingle ?? teamArray[0]);
    if (appleTeamId === null || !TEAM_ID_PATTERN.test(appleTeamId)) {
      return yield* Effect.fail(
        new InvalidProvisioningProfile({ message: "TeamIdentifier missing or malformed" }),
      );
    }

    const appIdentifier = matchStringTag(plist, "application-identifier");
    if (appIdentifier === null) {
      return yield* Effect.fail(
        new InvalidProvisioningProfile({
          message: "application-identifier missing from profile plist",
        }),
      );
    }
    const bundlePrefix = `${appleTeamId}.`;
    const bundleIdentifier = appIdentifier.startsWith(bundlePrefix)
      ? appIdentifier.slice(bundlePrefix.length)
      : appIdentifier;
    if (bundleIdentifier.length === 0) {
      return yield* Effect.fail(
        new InvalidProvisioningProfile({ message: "Bundle identifier is empty" }),
      );
    }

    const profileName = matchStringTag(plist, "Name");
    const portalIdentifier = matchStringTag(plist, "UUID");
    const validUntil = matchDateTag(plist, "ExpirationDate");
    const certificateSerialNumbers = extractStringArray(plist, "DeveloperCertificates");

    const parsed: ParsedProvisioningProfile = {
      bundleIdentifier,
      distributionType: inferDistributionType(plist),
      appleTeamId,
      developerPortalIdentifier: portalIdentifier,
      profileName,
      validUntil,
      certificateSerialNumbers,
    };
    return parsed;
  });
