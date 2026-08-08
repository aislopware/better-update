import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { DISTRIBUTION_ORDER } from "./-ios-detail-shared";

type DistributionType = IosBundleConfigurationItem["distributionType"];

/** Which of a bundle's four credential slots have something bound to them. */
export interface IosSigningSlots {
  readonly certificate: boolean;
  readonly profile: boolean;
  readonly pushKey: boolean;
  readonly ascKey: boolean;
}

export interface IosBundleGroup {
  readonly bundleIdentifier: string;
  readonly configs: readonly IosBundleConfigurationItem[];
  readonly targetName: string | null;
  readonly parentBundleIdentifier: string | null;
  readonly distributionTypes: readonly DistributionType[];
  readonly appleTeamIds: readonly string[];
  readonly slots: IosSigningSlots;
  readonly updatedAt: string;
}

const firstNonEmpty = (
  configs: readonly IosBundleConfigurationItem[],
  read: (config: IosBundleConfigurationItem) => string | null,
): string | null => {
  const found = configs.map(read).find((value) => value !== null && value !== "");
  return found === undefined ? null : found;
};

/** A bucket always holds the configuration that created it, so there is a date to start from. */
type ConfigBucket = readonly [IosBundleConfigurationItem, ...IosBundleConfigurationItem[]];

const latestUpdatedAt = ([first, ...rest]: ConfigBucket): string =>
  rest.reduce(
    (latest, config) =>
      Date.parse(config.updatedAt) > Date.parse(latest) ? config.updatedAt : latest,
    first.updatedAt,
  );

/**
 * One row per bundle identifier, carrying what the list can say about it
 * without opening it: which distribution types are configured, whose team they
 * sign under, and which credential slots are filled.
 *
 * A bundle identifier holds one configuration per distribution type, and the
 * slots are read across all of them — "bound" here means at least one
 * configuration has that slot filled, which is the question the list answers
 * ("is there a certificate for this bundle at all?"). Which distribution type
 * it belongs to is the detail page's job.
 */
export const groupIosConfigs = (
  items: readonly IosBundleConfigurationItem[],
): readonly IosBundleGroup[] => {
  const buckets = items.reduce<Map<string, ConfigBucket>>((acc, config) => {
    const list = acc.get(config.bundleIdentifier);
    acc.set(config.bundleIdentifier, list === undefined ? [config] : [...list, config]);
    return acc;
  }, new Map());

  return Array.from(buckets, ([bundleIdentifier, configs]) => ({
    bundleIdentifier,
    configs,
    targetName: firstNonEmpty(configs, (config) => config.targetName),
    parentBundleIdentifier: firstNonEmpty(configs, (config) => config.parentBundleIdentifier),
    distributionTypes: DISTRIBUTION_ORDER.filter((type) =>
      configs.some((config) => config.distributionType === type),
    ),
    appleTeamIds: [...new Set(configs.map((config) => config.appleTeamId))],
    slots: {
      certificate: configs.some((config) => config.appleDistributionCertificateId !== null),
      profile: configs.some((config) => config.appleProvisioningProfileId !== null),
      pushKey: configs.some((config) => config.applePushKeyId !== null),
      ascKey: configs.some((config) => config.ascApiKeyId !== null),
    },
    updatedAt: latestUpdatedAt(configs),
  })).toSorted((left, right) => left.bundleIdentifier.localeCompare(right.bundleIdentifier));
};

/** What an Android application identifier's credential groups add up to. */
export interface AndroidCredentialSummary {
  readonly groupCount: number;
  /** The group the CLI reaches for when a build profile names none. */
  readonly defaultGroupName: string | null;
  readonly keystoreAlias: string | null;
  readonly hasSubmissionsKey: boolean;
  readonly hasFcmKey: boolean;
}

/**
 * The list shows the default group because that is the one a build gets unless
 * it asks for another by name; the count says how many others are waiting
 * behind it, and the detail page switches between them.
 */
export const summarizeAndroidCredentials = (
  groups: readonly AndroidBuildCredentialsItem[],
  keystores: readonly AndroidUploadKeystoreItem[],
): AndroidCredentialSummary => {
  const sorted = [...groups].toSorted((left, right) => left.name.localeCompare(right.name));
  const primary = sorted.find((group) => group.isDefault) ?? sorted[0];
  if (primary === undefined) {
    return {
      groupCount: 0,
      defaultGroupName: null,
      keystoreAlias: null,
      hasSubmissionsKey: false,
      hasFcmKey: false,
    };
  }

  const { androidUploadKeystoreId } = primary;
  const keystore =
    androidUploadKeystoreId === null
      ? undefined
      : keystores.find((item) => item.id === androidUploadKeystoreId);

  return {
    groupCount: groups.length,
    defaultGroupName: primary.name,
    keystoreAlias: keystore === undefined ? null : keystore.keyAlias,
    hasSubmissionsKey: Boolean(primary.googleServiceAccountKeyForSubmissionsId),
    hasFcmKey: Boolean(primary.googleServiceAccountKeyForFcmV1Id),
  };
};
