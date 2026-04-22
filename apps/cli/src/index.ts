#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { analyticsCommand } from "./commands/analytics";
import { auditLogsCommand } from "./commands/audit-logs";
import { branchesCommand } from "./commands/branches";
import { buildCommand } from "./commands/build";
import { buildsCommand } from "./commands/builds";
import { channelsCommand } from "./commands/channels";
import { credentialsCommand } from "./commands/credentials";
import { envCommand } from "./commands/env";
import { fingerprintCommand } from "./commands/fingerprint";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { projectsCommand } from "./commands/projects";
import { statusCommand } from "./commands/status";
import { updateCommand } from "./commands/update";

const main = defineCommand({
  meta: {
    name: "better-update",
    version: "0.1.0",
    description: "Publish OTA updates and builds for Expo apps",
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    init: initCommand,
    status: statusCommand,
    projects: projectsCommand,
    branches: branchesCommand,
    channels: channelsCommand,
    build: buildCommand,
    builds: buildsCommand,
    credentials: credentialsCommand,
    env: envCommand,
    fingerprint: fingerprintCommand,
    update: updateCommand,
    analytics: analyticsCommand,
    "audit-logs": auditLogsCommand,
  },
});

await runMain(main);
