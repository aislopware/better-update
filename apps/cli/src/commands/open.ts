import { spawn } from "node:child_process";

import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { extractSlug, readExpoConfig } from "../lib/expo-config";
import { printHuman } from "../lib/output";
import { optionalArgument } from "../lib/params";
import { runCommand } from "../lib/run-command";
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

const resolveOpenCommand = (
  platform: NodeJS.Platform,
  url: string,
): readonly [command: string, args: readonly string[]] => {
  if (platform === "darwin") {
    return ["open", [url]];
  }
  if (platform === "win32") {
    return ["cmd", ["/c", "start", "", url]];
  }
  return ["xdg-open", [url]];
};

// Detached + unref'd so the CLI exits immediately; no shell, the URL is a
// plain argument.
const openInBrowser = (url: string, platform: NodeJS.Platform): Effect.Effect<void> =>
  Effect.sync(() => {
    const [command, args] = resolveOpenCommand(platform, url);
    const child = spawn(command, [...args], { detached: true, stdio: "ignore" });
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

export const openCommand = Command.make(
  "open",
  {
    resource: Argument.String("resource").pipe(
      Argument.withDescription(
        "Sub-resource: builds, updates, channels, branches, credentials, devices, env-vars, webhooks, settings",
      ),
      optionalArgument,
    ),
  },
  Effect.fn(function* (args) {
    const runtime = yield* CliRuntime;
    const url = yield* resolveTargetUrl(args.resource);
    yield* printHuman(`Opening ${url}`);
    yield* openInBrowser(url, runtime.platform);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Open the dashboard URL (project or sub-resource) in the default browser",
  ),
);
