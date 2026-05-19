import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";

export type EasAndroidSubmitReleaseStatus = "completed" | "draft" | "halted" | "inProgress";

export interface EasIosSubmitProfile {
  readonly appleId?: string;
  readonly ascAppId?: string;
  readonly appleTeamId?: string;
  readonly ascApiKeyPath?: string;
  readonly ascApiKeyId?: string;
  readonly ascApiKeyIssuerId?: string;
  readonly sku?: string;
  readonly language?: string;
  readonly companyName?: string;
  readonly appName?: string;
  readonly bundleIdentifier?: string;
  readonly metadataPath?: string;
  readonly groups?: readonly string[];
}

export interface EasAndroidSubmitProfile {
  readonly serviceAccountKeyPath?: string;
  readonly serviceAccountKeyId?: string;
  readonly track?: string;
  readonly releaseStatus?: EasAndroidSubmitReleaseStatus;
  readonly changesNotSentForReview?: boolean;
  readonly rollout?: number;
  readonly applicationId?: string;
}

export interface EasSubmitProfile {
  readonly extends?: string;
  readonly ios?: EasIosSubmitProfile;
  readonly android?: EasAndroidSubmitProfile;
}

const MAX_SUBMIT_EXTENDS_DEPTH = 10;

const asStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asBooleanValue = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asNumberValue = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;

const asStringArray = (raw: unknown): readonly string[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const items = raw.filter((item): item is string => typeof item === "string");
  return items.length === 0 ? undefined : items;
};

const asAndroidReleaseStatus = (raw: unknown): EasAndroidSubmitReleaseStatus | undefined => {
  const value = asStringValue(raw);
  return value === "completed" || value === "draft" || value === "halted" || value === "inProgress"
    ? value
    : undefined;
};

const parseIosSubmitProfile = (raw: unknown): EasIosSubmitProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const appleId = asStringValue(record["appleId"]);
  const ascAppId = asStringValue(record["ascAppId"]);
  const appleTeamId = asStringValue(record["appleTeamId"]);
  const ascApiKeyPath = asStringValue(record["ascApiKeyPath"]);
  const ascApiKeyId = asStringValue(record["ascApiKeyId"]);
  const ascApiKeyIssuerId = asStringValue(record["ascApiKeyIssuerId"]);
  const sku = asStringValue(record["sku"]);
  const language = asStringValue(record["language"]);
  const companyName = asStringValue(record["companyName"]);
  const appName = asStringValue(record["appName"]);
  const bundleIdentifier = asStringValue(record["bundleIdentifier"]);
  const metadataPath = asStringValue(record["metadataPath"]);
  const groups = asStringArray(record["groups"]);
  return {
    ...(appleId === undefined ? {} : { appleId }),
    ...(ascAppId === undefined ? {} : { ascAppId }),
    ...(appleTeamId === undefined ? {} : { appleTeamId }),
    ...(ascApiKeyPath === undefined ? {} : { ascApiKeyPath }),
    ...(ascApiKeyId === undefined ? {} : { ascApiKeyId }),
    ...(ascApiKeyIssuerId === undefined ? {} : { ascApiKeyIssuerId }),
    ...(sku === undefined ? {} : { sku }),
    ...(language === undefined ? {} : { language }),
    ...(companyName === undefined ? {} : { companyName }),
    ...(appName === undefined ? {} : { appName }),
    ...(bundleIdentifier === undefined ? {} : { bundleIdentifier }),
    ...(metadataPath === undefined ? {} : { metadataPath }),
    ...(groups === undefined ? {} : { groups }),
  };
};

const parseAndroidSubmitProfile = (raw: unknown): EasAndroidSubmitProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const serviceAccountKeyPath = asStringValue(record["serviceAccountKeyPath"]);
  const serviceAccountKeyId = asStringValue(record["serviceAccountKeyId"]);
  const track = asStringValue(record["track"]);
  const releaseStatus = asAndroidReleaseStatus(record["releaseStatus"]);
  const changesNotSentForReview = asBooleanValue(record["changesNotSentForReview"]);
  const rollout = asNumberValue(record["rollout"]);
  const applicationId = asStringValue(record["applicationId"]);
  return {
    ...(serviceAccountKeyPath === undefined ? {} : { serviceAccountKeyPath }),
    ...(serviceAccountKeyId === undefined ? {} : { serviceAccountKeyId }),
    ...(track === undefined ? {} : { track }),
    ...(releaseStatus === undefined ? {} : { releaseStatus }),
    ...(changesNotSentForReview === undefined ? {} : { changesNotSentForReview }),
    ...(rollout === undefined ? {} : { rollout }),
    ...(applicationId === undefined ? {} : { applicationId }),
  };
};

export const parseSubmitProfile = (raw: unknown): EasSubmitProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const extendsName = asStringValue(record["extends"]);
  const ios = parseIosSubmitProfile(record["ios"]);
  const android = parseAndroidSubmitProfile(record["android"]);
  return {
    ...(extendsName === undefined ? {} : { extends: extendsName }),
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android }),
  };
};

const mergeIosSubmit = (
  base: EasIosSubmitProfile | undefined,
  overlay: EasIosSubmitProfile | undefined,
): EasIosSubmitProfile | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

const mergeAndroidSubmit = (
  base: EasAndroidSubmitProfile | undefined,
  overlay: EasAndroidSubmitProfile | undefined,
): EasAndroidSubmitProfile | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

const mergeSubmitProfile = (
  base: EasSubmitProfile,
  overlay: EasSubmitProfile,
): EasSubmitProfile => {
  const ios = mergeIosSubmit(base.ios, overlay.ios);
  const android = mergeAndroidSubmit(base.android, overlay.android);
  return {
    ...(overlay.extends === undefined ? {} : { extends: overlay.extends }),
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android }),
  };
};

const collectSubmitExtendsChain = (
  profiles: Record<string, EasSubmitProfile>,
  profileName: string,
): Effect.Effect<readonly EasSubmitProfile[], BuildProfileError> =>
  Effect.gen(function* () {
    const chain: EasSubmitProfile[] = [];
    const visited = new Set<string>();
    let current: string | undefined = profileName;
    let depth = 0;
    while (current !== undefined) {
      if (visited.has(current)) {
        return yield* new BuildProfileError({
          message: `Cycle detected in eas.json submit.${profileName} extends chain at "${current}".`,
        });
      }
      visited.add(current);
      const profile: EasSubmitProfile | undefined = profiles[current];
      if (!profile) {
        return yield* new BuildProfileError({
          message:
            current === profileName
              ? `Submit profile "${profileName}" not found in eas.json.`
              : `Submit profile "${profileName}" extends missing profile "${current}".`,
        });
      }
      chain.unshift(profile);
      current = profile.extends;
      depth += 1;
      if (depth > MAX_SUBMIT_EXTENDS_DEPTH) {
        return yield* new BuildProfileError({
          message: `Too many "extends" levels (max ${String(MAX_SUBMIT_EXTENDS_DEPTH)}) in eas.json submit.${profileName}.`,
        });
      }
    }
    return chain;
  });

const stripSubmitExtends = (profile: EasSubmitProfile): EasSubmitProfile => {
  if (profile.extends === undefined) {
    return profile;
  }
  const { extends: _omit, ...rest } = profile;
  return rest;
};

export const resolveEasSubmitProfile = (
  profiles: Record<string, EasSubmitProfile> | undefined,
  profileName: string,
): Effect.Effect<EasSubmitProfile, BuildProfileError> =>
  Effect.gen(function* () {
    if (!profiles) {
      return yield* new BuildProfileError({
        message: 'eas.json has no "submit" section. Add at least one submit profile.',
      });
    }
    const chain = yield* collectSubmitExtendsChain(profiles, profileName);
    const merged = chain.reduce<EasSubmitProfile>(
      (acc, next, index) => (index === 0 ? next : mergeSubmitProfile(acc, next)),
      {},
    );
    return stripSubmitExtends(merged);
  });
