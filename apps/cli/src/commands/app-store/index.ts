import { defineCommand } from "citty";

import { appStoreAgeRatingCommand } from "./age-rating";
import { appStoreAppsCommand } from "./apps";
import { appStoreAvailabilityCommand } from "./availability";
import { appStoreCancelCommand } from "./cancel";
import { appStoreCategoriesCommand } from "./categories";
import { appStoreConfigCommand } from "./config";
import { appStoreInfoCommand } from "./info";
import { appStorePricingCommand } from "./pricing";
import { appStorePrivacyCommand } from "./privacy";
import { appStoreRejectCommand } from "./reject";
import { appStoreReleaseCommand } from "./release";
import { appStoreReviewDetailCommand } from "./review-detail";
import { appStoreRolloutCommand } from "./rollout";
import { appStoreStatusCommand } from "./status";
import { appStoreSubmitCommand } from "./submit";
import { appStoreTerritoriesCommand } from "./territories";
import { appStoreVersionCommand } from "./version";

export const appStoreCommand = defineCommand({
  meta: {
    name: "app-store",
    description:
      "Drive the App Store release pipeline on App Store Connect (CI-safe, uses an ASC API key)",
  },
  subCommands: {
    version: appStoreVersionCommand,
    submit: appStoreSubmitCommand,
    status: appStoreStatusCommand,
    cancel: appStoreCancelCommand,
    release: appStoreReleaseCommand,
    reject: appStoreRejectCommand,
    rollout: appStoreRolloutCommand,
    "review-detail": appStoreReviewDetailCommand,
    info: appStoreInfoCommand,
    categories: appStoreCategoriesCommand,
    "age-rating": appStoreAgeRatingCommand,
    privacy: appStorePrivacyCommand,
    apps: appStoreAppsCommand,
    pricing: appStorePricingCommand,
    availability: appStoreAvailabilityCommand,
    territories: appStoreTerritoriesCommand,
    config: appStoreConfigCommand,
  },
});
