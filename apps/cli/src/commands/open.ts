import { spawn } from "node:child_process";

import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { extractSlug, readExpoConfig } from "../lib/expo-config";
import { printHuman } from "../lib/output";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

const RESOURCE_PATHS: Record<string, string> = {
  builds: "builds",
  updates: "updates",
  channels: "channels",
  branches: "branches",
  credentials: "credentials",
  devices: "apple-devices",
  "env-vars": "environment-variables",
  webhooks: "webhooks",
  settings: "settings",
};

const resolveOpenCommand = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "open";
  }
  if (platform === "win32") {
    return "start";
  }
  return "xdg-open";
};

const openInBrowser = (url: string, platform: NodeJS.Platform): Effect.Effect<void> =>
  Effect.sync(() => {
    const child = spawn(resolveOpenCommand(platform), [url], {
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    child.unref();
  });

const resolveTargetUrl = (resource: string | undefined) =>
  Effect.gen(function* () {
    const config = yield* ConfigStore;
    const webUrl = yield* config.getWebUrl;
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const expo = yield* readExpoConfig(projectRoot).pipe(Effect.option);
    const slug =
      expo._tag === "Some" ? yield* extractSlug(expo.value).pipe(Effect.option) : undefined;
    const projectPath = slug?._tag === "Some" ? `/projects/${slug.value}` : "";
    if (!resource || resource === "project") {
      return projectPath ? `${webUrl}${projectPath}` : webUrl;
    }
    const subPath = RESOURCE_PATHS[resource] ?? resource;
    return projectPath ? `${webUrl}${projectPath}/${subPath}` : `${webUrl}/${subPath}`;
  });

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open the dashboard URL (project or sub-resource) in the default browser",
  },
  args: {
    resource: {
      type: "positional",
      required: false,
      description:
        "Sub-resource: builds, updates, channels, branches, credentials, devices, env-vars, webhooks, settings",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const url = yield* resolveTargetUrl(args.resource);
        yield* printHuman(`Opening ${url}`);
        yield* openInBrowser(url, runtime.platform);
      }),
    ),
});
