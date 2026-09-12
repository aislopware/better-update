import { Command } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
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

export const appStoreCommand = Command.make("app-store").pipe(
  Command.withDescription(
    "Drive the App Store release pipeline on App Store Connect (CI-safe, uses an ASC API key)",
  ),
  Command.withSubcommands([
    appStoreVersionCommand,
    appStoreSubmitCommand,
    appStoreStatusCommand,
    appStoreCancelCommand,
    appStoreReleaseCommand,
    appStoreRejectCommand,
    appStoreRolloutCommand,
    appStoreReviewDetailCommand,
    appStoreInfoCommand,
    appStoreCategoriesCommand,
    appStoreAgeRatingCommand,
    appStorePrivacyCommand,
    appStoreAppsCommand,
    appStorePricingCommand,
    appStoreAvailabilityCommand,
    appStoreTerritoriesCommand,
    appStoreConfigCommand,
  ]),
  Command.provide(applePortalExitCodes),
);
