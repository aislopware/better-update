import { asRecord, compact } from "@better-update/type-guards";
import { Effect } from "effect";

import {
  asBooleanValue,
  asNumberValue,
  asStringValue,
  resolveExtendsChain,
  shallowMerge,
  stripExtends,
} from "./eas-profile-extends";
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
  return compact({
    appleId,
    ascAppId,
    appleTeamId,
    ascApiKeyPath,
    ascApiKeyId,
    ascApiKeyIssuerId,
    sku,
    language,
    companyName,
    appName,
    bundleIdentifier,
    metadataPath,
    groups,
  });
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
  return compact({
    serviceAccountKeyPath,
    serviceAccountKeyId,
    track,
    releaseStatus,
    changesNotSentForReview,
    rollout,
    applicationId,
  });
};

export const parseSubmitProfile = (raw: unknown): EasSubmitProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const extendsName = asStringValue(record["extends"]);
  const ios = parseIosSubmitProfile(record["ios"]);
  const android = parseAndroidSubmitProfile(record["android"]);
  return compact({ extends: extendsName, ios, android });
};

const mergeSubmitProfile = (
  base: EasSubmitProfile,
  overlay: EasSubmitProfile,
): EasSubmitProfile => {
  const ios = shallowMerge(base.ios, overlay.ios);
  const android = shallowMerge(base.android, overlay.android);
  return compact({ extends: overlay.extends, ios, android });
};

export const resolveEasSubmitProfile = (
  profiles: Record<string, EasSubmitProfile> | undefined,
  profileName: string,
  sourceLabel = "eas.json",
): Effect.Effect<EasSubmitProfile, BuildProfileError> =>
  Effect.gen(function* () {
    if (!profiles) {
      return yield* new BuildProfileError({
        message: `${sourceLabel} has no "submit" section. Add at least one submit profile.`,
      });
    }
    const chain = yield* resolveExtendsChain({
      profiles,
      profileName,
      label: "submit",
      maxDepth: MAX_SUBMIT_EXTENDS_DEPTH,
      sourceLabel,
      makeError: (message) => new BuildProfileError({ message }),
    });
    const merged = chain.reduce<EasSubmitProfile>(
      (acc, next, index) => (index === 0 ? next : mergeSubmitProfile(acc, next)),
      {},
    );
    return stripExtends(merged);
  });
