import type { IosBundleConfigurationItem } from "@better-update/api-client/react";

export const DISTRIBUTION_LABELS: Record<IosBundleConfigurationItem["distributionType"], string> = {
  APP_STORE: "App Store",
  AD_HOC: "Ad-Hoc",
  DEVELOPMENT: "Development",
  ENTERPRISE: "Enterprise",
};

export const DISTRIBUTION_ORDER: readonly IosBundleConfigurationItem["distributionType"][] = [
  "APP_STORE",
  "AD_HOC",
  "DEVELOPMENT",
  "ENTERPRISE",
];

/**
 * The Apple team every distribution of this bundle signs with, or null when they
 * disagree. One team is the ordinary case, and then it belongs in the header
 * rather than repeated down a column of every table on the page.
 */
export const sharedAppleTeamId = (
  configs: readonly IosBundleConfigurationItem[],
): string | null => {
  const [first] = configs;
  if (first === undefined) {
    return null;
  }
  return configs.every((config) => config.appleTeamId === first.appleTeamId)
    ? first.appleTeamId
    : null;
};

export const sortConfigsByDistribution = (
  configs: readonly IosBundleConfigurationItem[],
): readonly IosBundleConfigurationItem[] =>
  [...configs].toSorted(
    (left, right) =>
      DISTRIBUTION_ORDER.indexOf(left.distributionType) -
      DISTRIBUTION_ORDER.indexOf(right.distributionType),
  );
