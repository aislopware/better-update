import { analyticsCommand } from "./commands/analytics";
import { appReviewCommand } from "./commands/app-review";
import { appStoreCommand } from "./commands/app-store";
import { appleCommand } from "./commands/apple";
import { auditLogsCommand } from "./commands/audit-logs";
import { autocompleteCommand } from "./commands/autocomplete";
import { branchesCommand } from "./commands/branches";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { channelsCommand } from "./commands/channels";
import { credentialsCommand } from "./commands/credentials";
import { devicesCommand } from "./commands/devices";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { environmentsCommand } from "./commands/environments";
import { fingerprintCommand } from "./commands/fingerprint";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { macosCommand } from "./commands/macos";
import { metadataCommand } from "./commands/metadata";
import { openCommand } from "./commands/open";
import { orgCommand } from "./commands/org";
import { projectsCommand } from "./commands/projects";
import { reviewsCommand } from "./commands/reviews";
import { statusCommand } from "./commands/status";
import { submitCommand } from "./commands/submit";
import { testflightCommand } from "./commands/testflight";
import { updateCommand } from "./commands/update";
import { webhooksCommand } from "./commands/webhooks";
import { whoamiCommand } from "./commands/whoami";

/**
 * The single source of truth for the CLI's top-level command tree.
 *
 * `index.ts` mounts this list on the root command and the by-construction
 * coverage test (`command-coverage.test.ts`) walks the SAME list. Because both
 * consumers read this one registry, a new command is registered in exactly one
 * place and the coverage guarantee (every leaf routes through `runCommand`,
 * none re-declares a global flag) cannot silently drift from what ships.
 *
 * Kept side-effect free (no `Command.run`) so the test can import it without
 * booting the CLI.
 */
export const commandRegistry = [
  loginCommand,
  logoutCommand,
  initCommand,
  statusCommand,
  projectsCommand,
  branchesCommand,
  channelsCommand,
  environmentsCommand,
  buildCommand,
  buildsCommand,
  credentialsCommand,
  envCommand,
  fingerprintCommand,
  updateCommand,
  analyticsCommand,
  auditLogsCommand,
  whoamiCommand,
  orgCommand,
  openCommand,
  doctorCommand,
  devicesCommand,
  webhooksCommand,
  autocompleteCommand,
  appleCommand,
  appStoreCommand,
  macosCommand,
  submitCommand,
  testflightCommand,
  reviewsCommand,
  metadataCommand,
  appReviewCommand,
] as const;
