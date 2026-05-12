import path from "node:path";

import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import {
  extractProjectId,
  getConfigFilePaths,
  readExpoConfig,
  writeExpoConfigPatch,
} from "../../lib/expo-config";
import { printHuman, printKeyValue } from "../../lib/output";
import { ConfigStore } from "../../services/config-store";

type RuntimePolicy = "appVersion" | "fingerprint";

const RUNTIME_POLICIES: readonly RuntimePolicy[] = ["appVersion", "fingerprint"];

const isRuntimePolicy = (value: string): value is RuntimePolicy =>
  (RUNTIME_POLICIES as readonly string[]).includes(value);

const renderManualHint = (manifestUrl: string, policy: RuntimePolicy): string =>
  [
    "Cannot write to a dynamic Expo config. Add these fields manually:",
    "",
    `  runtimeVersion: { policy: "${policy}" },`,
    `  updates: { url: "${manifestUrl}" }`,
  ].join("\n");

const readExistingUpdateUrl = (config: Record<string, unknown>): string | undefined => {
  const { updates } = config;
  if (typeof updates !== "object" || updates === null || !("url" in updates)) {
    return undefined;
  }
  const { url } = updates as { readonly url?: unknown };
  return typeof url === "string" ? url : undefined;
};

export const configureCommand = defineCommand({
  meta: {
    name: "configure",
    description:
      "Wire expo-updates plugin into your Expo config (runtimeVersion + updates.url for this project)",
  },
  args: {
    "runtime-policy": {
      type: "string",
      default: "appVersion",
      description: "Runtime version policy: appVersion or fingerprint",
    },
    force: {
      type: "boolean",
      description: "Overwrite existing runtimeVersion / updates.url fields",
    },
  },
  run: async ({ args }) =>
    runEffect(
      // eslint-disable-next-line eslint/max-statements -- linear orchestration: validate policy → read config/baseUrl → check existing → write or hint
      Effect.gen(function* () {
        if (!isRuntimePolicy(args["runtime-policy"])) {
          return yield* new InvalidArgumentError({
            message: `Invalid --runtime-policy "${args["runtime-policy"]}". Use "appVersion" or "fingerprint".`,
          });
        }
        const policy = args["runtime-policy"];

        const configStore = yield* ConfigStore;
        const baseUrl = yield* configStore.getBaseUrl;

        const projectRoot = process.cwd();
        const expoConfig = yield* readExpoConfig(projectRoot);
        const projectId = yield* extractProjectId(expoConfig);

        const manifestUrl = `${baseUrl}/manifest/${projectId}`;

        const existingRuntime = expoConfig.runtimeVersion;
        const existingUrl = readExistingUpdateUrl(expoConfig);

        if (!args.force && (existingRuntime !== undefined || existingUrl !== undefined)) {
          yield* Console.log("Expo config already has runtimeVersion or updates.url set:");
          if (existingRuntime !== undefined) {
            yield* Console.log(`  runtimeVersion: ${JSON.stringify(existingRuntime)}`);
          }
          if (existingUrl !== undefined) {
            yield* Console.log(`  updates.url: ${existingUrl}`);
          }
          yield* Console.log("");
          yield* Console.log("Pass --force to overwrite.");
          return undefined;
        }

        const result = yield* writeExpoConfigPatch(projectRoot, {
          runtimeVersion: { policy },
          updates: { url: manifestUrl },
        });

        if (result.configPath === null) {
          yield* printHuman(renderManualHint(manifestUrl, policy));
          return undefined;
        }

        const paths = yield* getConfigFilePaths(projectRoot);
        const targetPath = paths.staticConfigPath
          ? path.relative(projectRoot, paths.staticConfigPath)
          : "your Expo config";

        yield* Console.log(`Wired expo-updates plugin into ${targetPath}.`);
        yield* printKeyValue([
          ["runtimeVersion.policy", policy],
          ["updates.url", manifestUrl],
        ]);
        return undefined;
      }),
    ),
});
