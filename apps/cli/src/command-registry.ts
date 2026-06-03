import { analyticsCommand } from "./commands/analytics";
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
import { fingerprintCommand } from "./commands/fingerprint";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { migrateConfigCommand } from "./commands/migrate-config";
import { openCommand } from "./commands/open";
import { projectsCommand } from "./commands/projects";
import { rolesCommand } from "./commands/roles";
import { statusCommand } from "./commands/status";
import { submitCommand } from "./commands/submit";
import { updateCommand } from "./commands/update";
import { webhooksCommand } from "./commands/webhooks";
import { whoamiCommand } from "./commands/whoami";

/**
 * The single source of truth for the CLI's top-level command tree.
 *
 * `index.ts` spreads this into `defineCommand({ subCommands })` and the
 * by-construction coverage test (`command-coverage.test.ts`) walks the SAME
 * object. Because both consumers read this one registry, a new command is
 * registered in exactly one place and the coverage guarantee (every leaf exposes
 * the global `--json` / `--non-interactive` contract and routes through
 * `runEffect`) cannot silently drift from what ships.
 *
 * The type is left inferred (a record of each command's specific
 * `CommandDef<…>`): citty's `subCommands` accepts it structurally and a wider
 * `Record<string, CommandDef>` annotation would trip `exactOptionalPropertyTypes`
 * on the per-command arg generics.
 *
 * Kept side-effect free (no `runMain`, no `process.argv` rewrite) so the test can
 * import it without booting the CLI.
 */
export const commandRegistry = {
  login: loginCommand,
  logout: logoutCommand,
  init: initCommand,
  status: statusCommand,
  projects: projectsCommand,
  branches: branchesCommand,
  channels: channelsCommand,
  roles: rolesCommand,
  build: buildCommand,
  builds: buildsCommand,
  credentials: credentialsCommand,
  env: envCommand,
  fingerprint: fingerprintCommand,
  update: updateCommand,
  analytics: analyticsCommand,
  "audit-logs": auditLogsCommand,
  whoami: whoamiCommand,
  open: openCommand,
  doctor: doctorCommand,
  devices: devicesCommand,
  webhooks: webhooksCommand,
  autocomplete: autocompleteCommand,
  "migrate-config": migrateConfigCommand,
  apple: appleCommand,
  submit: submitCommand,
};
