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

export const sortConfigsByDistribution = (
  configs: readonly IosBundleConfigurationItem[],
): readonly IosBundleConfigurationItem[] =>
  [...configs].toSorted(
    (left, right) =>
      DISTRIBUTION_ORDER.indexOf(left.distributionType) -
      DISTRIBUTION_ORDER.indexOf(right.distributionType),
  );
