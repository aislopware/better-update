import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runUpdatePublish } from "../../application/update-publish";
import { runEffect } from "../../lib/citty-effect";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { printTable } from "../../lib/output";

const PUBLISH_EXIT_EXTRAS = {
  BuildProfileError: 2,
  RuntimeVersionError: 2,
  EnvExportError: 7,
  BuildFailedError: 6,
  UpdatePublishError: 7,
  DirtyRepoError: 3,
} as const;

export const publishCommand = defineCommand({
  meta: { name: "publish", description: "Publish a new OTA update group" },
  args: {
    branch: { type: "string", description: "Target branch name" },
    channel: {
      type: "string",
      description: "Channel name to route the update through (resolves to branch)",
    },
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Platform(s) to publish",
    },
    message: { type: "string", description: "Optional update message" },
    environment: { type: "string", default: "production", description: "Env vars scope" },
    auto: { type: "boolean", description: "Skip prompts (for CI)" },
    clear: { type: "boolean", description: "Drop existing assets before upload" },
    "rollout-percentage": { type: "string", description: "Initial rollout percentage (1-100)" },
    "input-dir": {
      type: "string",
      description: "Path to a pre-bundled Expo export directory (skips re-running expo export)",
    },
    "skip-bundler": {
      type: "boolean",
      description: "Skip running expo export — requires --input-dir to point at the bundle",
    },
    "emit-metadata": {
      type: "boolean",
      description: "Write eas-update-metadata.json into the export directory after publish",
    },
    "manifest-body-file": { type: "string" },
    "signature-file": { type: "string" },
    "certificate-chain-file": { type: "string" },
    "manifest-body-file-ios": { type: "string" },
    "signature-file-ios": { type: "string" },
    "certificate-chain-file-ios": { type: "string" },
    "manifest-body-file-android": { type: "string" },
    "signature-file-android": { type: "string" },
    "certificate-chain-file-android": { type: "string" },
    "allow-dirty": {
      type: "boolean",
      description: "Proceed even with uncommitted git changes",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const rolloutPercentage = args["rollout-percentage"]
          ? yield* parseRolloutPercentage(args["rollout-percentage"], "rollout-percentage")
          : undefined;

        const result = yield* runUpdatePublish({
          branch: args.branch,
          channel: args.channel,
          platform: args.platform,
          message: args.message,
          auto: args.auto ?? false,
          environment: args.environment,
          clear: args.clear ?? false,
          allowDirty: args["allow-dirty"] ?? false,
          rolloutPercentage,
          inputDir: args["input-dir"],
          skipBundler: args["skip-bundler"] ?? false,
          emitMetadata: args["emit-metadata"] ?? false,
          manifestBodyFile: args["manifest-body-file"],
          signatureFile: args["signature-file"],
          certificateChainFile: args["certificate-chain-file"],
          manifestBodyFileIos: args["manifest-body-file-ios"],
          signatureFileIos: args["signature-file-ios"],
          certificateChainFileIos: args["certificate-chain-file-ios"],
          manifestBodyFileAndroid: args["manifest-body-file-android"],
          signatureFileAndroid: args["signature-file-android"],
          certificateChainFileAndroid: args["certificate-chain-file-android"],
        });

        yield* Console.log(
          `Published update group ${result.groupId} to branch "${result.branch}".`,
        );
        yield* Console.log("");
        yield* printTable(
          ["Platform", "Update ID", "Runtime Version", "Uploaded", "Reused"],
          result.results.map((entry) => [
            entry.platform,
            entry.updateId,
            entry.runtimeVersion,
            String(entry.uploadedAssets),
            String(entry.deduplicatedAssets),
          ]),
        );
      }),
      PUBLISH_EXIT_EXTRAS,
    ),
});
