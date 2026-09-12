import path from "node:path";

import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  extractProjectId,
  getConfigFilePaths,
  readExpoConfig,
  writeExpoConfigPatch,
} from "../../lib/expo-config";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import {
  buildUpdatesPatch,
  CHECK_AUTOMATICALLY_VALUES,
  CONFIGURE_DEFAULTS,
  describeUpdatesPatch,
  extractExistingUpdatesConfig,
  parseRequestHeaders,
  RUNTIME_POLICIES,
  validateCheckAutomatically,
  validateFallbackTimeout,
  validateRuntimePolicy,
} from "../../lib/updates-config";
import { CliRuntime } from "../../services/cli-runtime";
import { ConfigStore } from "../../services/config-store";

import type { ExpoConfig } from "../../lib/expo-config";
import type { ExpoUpdatesPatch } from "../../lib/updates-config";

const renderManualHint = (patch: ExpoUpdatesPatch): string =>
  [
    "Cannot write to a dynamic Expo config. Add these fields manually:",
    "",
    `  runtimeVersion: { policy: "${patch.runtimeVersion.policy}" },`,
    `  updates: ${JSON.stringify(patch.updates, null, 2).replaceAll("\n", "\n  ")}`,
  ].join("\n");

const readExistingUpdateUrl = (config: ExpoConfig): string | undefined => {
  const url = config.updates?.url;
  return typeof url === "string" ? url : undefined;
};

export const configureCommand = Command.make(
  "configure",
  {
    "runtime-policy": Flag.String("runtime-policy").pipe(
      Flag.withDescription(
        `Runtime version policy: one of ${RUNTIME_POLICIES.join(", ")} (default: ${CONFIGURE_DEFAULTS.runtimePolicy})`,
      ),
      optionalFlag,
    ),
    "check-automatically": Flag.String("check-automatically").pipe(
      Flag.withDescription(
        `When to check for updates: one of ${CHECK_AUTOMATICALLY_VALUES.join(", ")} (default: ${CONFIGURE_DEFAULTS.checkAutomatically})`,
      ),
      optionalFlag,
    ),
    "fallback-timeout": Flag.String("fallback-timeout").pipe(
      Flag.withDescription(
        `Milliseconds to wait for an update at launch before falling back to cache (0–300000, default: ${CONFIGURE_DEFAULTS.fallbackToCacheTimeout})`,
      ),
      optionalFlag,
    ),
    "enable-bsdiff": Flag.Boolean("enable-bsdiff").pipe(
      Flag.withDescription(
        `Enable bsdiff patch downloads on device (sends A-IM: bsdiff, default: ${CONFIGURE_DEFAULTS.enableBsdiffPatchSupport}); Disable bsdiff patch downloads (use --no-enable-bsdiff)`,
      ),
      optionalFlag,
    ),
    "disable-anti-bricking-measures": Flag.Boolean("disable-anti-bricking-measures").pipe(
      Flag.withDescription(
        `Disable on-device anti-bricking guards (default: ${CONFIGURE_DEFAULTS.disableAntiBrickingMeasures}; NOT recommended for production); Keep anti-bricking guards active (use --no-disable-anti-bricking-measures)`,
      ),
      optionalFlag,
    ),
    "use-embedded-update": Flag.Boolean("use-embedded-update").pipe(
      Flag.withDescription(
        `Use the bundled JS as the initial update (default: ${CONFIGURE_DEFAULTS.useEmbeddedUpdate}); Do not use the embedded update (use --no-use-embedded-update)`,
      ),
      optionalFlag,
    ),
    enabled: Flag.Boolean("enabled").pipe(
      Flag.withDescription(
        `Whether the OTA update system runs (default: ${CONFIGURE_DEFAULTS.enabled}); Disable the OTA update system (use --no-enabled)`,
      ),
      optionalFlag,
    ),
    "request-header": Flag.String("request-header").pipe(
      Flag.withDescription("Extra request header as KEY=VALUE (repeatable)"),
      Flag.atLeast(0),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription(
        "Rewrite even when runtimeVersion / updates.url already exist. updates.* fields are merged with existing values (flags you pass win; fields you omit are preserved), not blindly overwritten",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    // eslint-disable-next-line eslint/max-statements -- linear orchestration: validate flags → read config/baseUrl → check existing → write or hint
    function* (args) {
      const runtimePolicy = yield* validateRuntimePolicy(args["runtime-policy"]);
      const checkAutomatically = yield* validateCheckAutomatically(args["check-automatically"]);
      const fallbackToCacheTimeout = yield* validateFallbackTimeout(args["fallback-timeout"]);
      const requestHeaders = yield* parseRequestHeaders(args["request-header"]);

      const configStore = yield* ConfigStore;
      const baseUrl = yield* configStore.getBaseUrl;

      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const expoConfig = yield* readExpoConfig(projectRoot);
      const projectId = yield* extractProjectId(expoConfig);

      const manifestUrl = `${baseUrl}/manifest/${projectId}`;

      const existingRuntime = expoConfig.runtimeVersion;
      const existingUrl = readExistingUpdateUrl(expoConfig);

      if (!args.force && (existingRuntime !== undefined || existingUrl !== undefined)) {
        yield* printHuman("Expo config already has runtimeVersion or updates.url set:");
        if (existingRuntime !== undefined) {
          yield* printHuman(`  runtimeVersion: ${JSON.stringify(existingRuntime)}`);
        }
        if (existingUrl !== undefined) {
          yield* printHuman(`  updates.url: ${existingUrl}`);
        }
        yield* printHuman("");
        yield* printHuman("Pass --force to merge your flags into the existing config.");
        return { configured: false, reason: "already-configured" as const };
      }

      // Preserve existing updates.* values for any flag the user did not pass;
      // explicit flags win, omitted fields fall back to the existing value
      // (then the documented default). This keeps --force from clobbering.
      const patch = buildUpdatesPatch({
        manifestUrl,
        runtimePolicy,
        enabled: args.enabled,
        checkAutomatically,
        fallbackToCacheTimeout,
        useEmbeddedUpdate: args["use-embedded-update"],
        enableBsdiffPatchSupport: args["enable-bsdiff"],
        disableAntiBrickingMeasures: args["disable-anti-bricking-measures"],
        requestHeaders,
        existing: extractExistingUpdatesConfig(expoConfig),
      });

      const result = yield* writeExpoConfigPatch(projectRoot, patch);

      if (result.configPath === null) {
        yield* printHuman(renderManualHint(patch));
        return { configured: false, reason: "manual-config" as const, patch };
      }

      const paths = yield* getConfigFilePaths(projectRoot);
      const targetPath = paths.staticConfigPath
        ? path.relative(projectRoot, paths.staticConfigPath)
        : "your Expo config";

      yield* printHuman(`Wired expo-updates plugin into ${targetPath}.`);
      yield* printHumanKeyValue(describeUpdatesPatch(patch));
      return { configured: true, configPath: targetPath, patch };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Wire the full expo-updates config (runtimeVersion + updates.* incl. enableBsdiffPatchSupport) into your Expo config for this project",
  ),
);
