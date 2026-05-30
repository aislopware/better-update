import { DEFAULT_PATCH_BASE_WINDOW } from "@better-update/expo-protocol";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { formatSavingsPct } from "../../application/update-patch-phase";
import { runUpdatePublish } from "../../application/update-publish";
import { runEffect } from "../../lib/citty-effect";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { printHuman, printHumanTable } from "../../lib/output";

import type { PatchPhaseResult } from "../../application/update-patch-phase";

/**
 * Render the human-table "Patches" cell. Shows uploaded/attempted + skipped, and
 * appends the best savings% when at least one patch reported it (e.g. "94%
 * smaller"). The richer savings fields ride the JSON result envelope (this cell
 * is human-only via printHumanTable). `null` patches → "—".
 */
export const formatPatchesCell = (patches: PatchPhaseResult | null): string => {
  if (patches === null) {
    return "—";
  }
  const base = `${patches.uploaded}/${patches.attempted} (${patches.skipped} skipped)`;
  if (patches.bestSavingsPct === undefined) {
    return base;
  }
  return `${base}, ${formatSavingsPct(patches.bestSavingsPct)}% smaller`;
};

const PUBLISH_EXIT_EXTRAS = {
  BuildProfileError: 2,
  RuntimeVersionError: 2,
  EnvExportError: 7,
  BuildFailedError: 6,
  UpdatePublishError: 7,
  DirtyRepoError: 3,
  BsdiffError: 7,
  PatchUploadError: 7,
  BaseDownloadError: 7,
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
    auto: {
      type: "boolean",
      description:
        "Skip prompts (for CI); infer the branch from the current git branch and the message from the latest commit subject",
    },
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
    "no-bytecode": {
      type: "boolean",
      description: "Disable Hermes bytecode compilation (emit raw JS)",
    },
    "source-maps": {
      type: "boolean",
      description: "Emit JavaScript source maps alongside bundles",
    },
    "private-key-path": {
      type: "string",
      description:
        "Path to the RSA private key (PEM) to code-sign the rendered manifest; reads codeSigningCertificate/codeSigningMetadata from app.json",
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
    "patch-base-window": {
      type: "string",
      description:
        "Max recent published updates to compute bsdiff patches against (default 10; 0 = embedded baseline only)",
    },
    "no-patches": {
      type: "boolean",
      description: "Skip the bsdiff patch generation phase entirely",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const rolloutPercentage = args["rollout-percentage"]
          ? yield* parseRolloutPercentage(args["rollout-percentage"], "rollout-percentage")
          : undefined;

        const parsedWindow = args["patch-base-window"]
          ? Number.parseInt(args["patch-base-window"], 10)
          : DEFAULT_PATCH_BASE_WINDOW;
        const patchBaseWindow =
          Number.isFinite(parsedWindow) && parsedWindow >= 0
            ? parsedWindow
            : DEFAULT_PATCH_BASE_WINDOW;

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
          noBytecode: args["no-bytecode"] ?? false,
          sourceMaps: args["source-maps"] ?? false,
          manifestBodyFile: args["manifest-body-file"],
          signatureFile: args["signature-file"],
          certificateChainFile: args["certificate-chain-file"],
          manifestBodyFileIos: args["manifest-body-file-ios"],
          signatureFileIos: args["signature-file-ios"],
          certificateChainFileIos: args["certificate-chain-file-ios"],
          manifestBodyFileAndroid: args["manifest-body-file-android"],
          signatureFileAndroid: args["signature-file-android"],
          certificateChainFileAndroid: args["certificate-chain-file-android"],
          privateKeyPath: args["private-key-path"],
          patchBaseWindow,
          noPatches: args["no-patches"] ?? false,
        });

        yield* printHuman(`Published update group ${result.groupId} to branch "${result.branch}".`);
        yield* printHuman("");
        yield* printHumanTable(
          ["Platform", "Update ID", "Runtime Version", "Uploaded", "Reused", "Patches"],
          result.results.map((entry) => [
            entry.platform,
            entry.updateId,
            entry.runtimeVersion,
            String(entry.uploadedAssets),
            String(entry.deduplicatedAssets),
            formatPatchesCell(entry.patches),
          ]),
        );
        return result;
      }),
      { exits: PUBLISH_EXIT_EXTRAS, json: "value" },
    ),
});
