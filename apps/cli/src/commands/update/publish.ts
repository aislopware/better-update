import { DEFAULT_PATCH_BASE_WINDOW } from "@better-update/expo-protocol";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { formatSavingsPct } from "../../application/update-patch-phase";
import { runUpdatePublish } from "../../application/update-publish";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { printHuman, printHumanTable } from "../../lib/output";
import { optionalFlag, optionalNonNegativeIntFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

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

export const publishCommand = Command.make(
  "publish",
  {
    branch: Flag.String("branch").pipe(Flag.withDescription("Target branch name"), optionalFlag),
    channel: Flag.String("channel").pipe(
      Flag.withDescription("Channel name to route the update through (resolves to branch)"),
      optionalFlag,
    ),
    platform: Flag.Literals("platform", ["ios", "android", "all"]).pipe(
      Flag.withDescription("Platform(s) to publish"),
      Flag.withDefault("all"),
    ),
    message: Flag.String("message").pipe(
      Flag.withDescription("Optional update message"),
      optionalFlag,
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Env vars scope (defaults to --profile's environment, else production)"),
      optionalFlag,
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription(
        "eas.json build profile to publish with: its environment picks the env scope and its env block overlays the server vars (profile wins on collision) — same merge as `build`",
      ),
      optionalFlag,
    ),
    auto: Flag.Boolean("auto").pipe(
      Flag.withDescription(
        "Skip prompts (for CI); infer the branch from the current git branch and the message from the latest commit subject",
      ),
      Flag.withDefault(false),
    ),
    clear: Flag.Boolean("clear").pipe(
      Flag.withDescription("Drop existing assets before upload"),
      Flag.withDefault(false),
    ),
    "rollout-percentage": Flag.String("rollout-percentage").pipe(
      Flag.withDescription("Initial rollout percentage (1-100)"),
      optionalFlag,
    ),
    "input-dir": Flag.String("input-dir").pipe(
      Flag.withDescription(
        "Path to a pre-bundled Expo export directory (skips re-running expo export)",
      ),
      optionalFlag,
    ),
    "skip-bundler": Flag.Boolean("skip-bundler").pipe(
      Flag.withDescription(
        "Skip running expo export — requires --input-dir to point at the bundle",
      ),
      Flag.withDefault(false),
    ),
    "emit-metadata": Flag.Boolean("emit-metadata").pipe(
      Flag.withDescription(
        "Write eas-update-metadata.json into the export directory after publish",
      ),
      Flag.withDefault(false),
    ),
    "no-bytecode": Flag.Boolean("no-bytecode").pipe(
      Flag.withDescription("Disable Hermes bytecode compilation (emit raw JS)"),
      Flag.withDefault(false),
    ),
    "source-maps": Flag.Boolean("source-maps").pipe(
      Flag.withDescription(
        "Emit JavaScript source maps and store them with the update for crash symbolication (--no-source-maps to skip)",
      ),
      Flag.withDefault(true),
    ),
    "private-key-path": Flag.String("private-key-path").pipe(
      Flag.withDescription(
        "Path to the RSA private key (PEM) to code-sign the rendered manifest; reads codeSigningCertificate/codeSigningMetadata from app.json",
      ),
      optionalFlag,
    ),
    "manifest-body-file": Flag.String("manifest-body-file").pipe(optionalFlag),
    "signature-file": Flag.String("signature-file").pipe(optionalFlag),
    "certificate-chain-file": Flag.String("certificate-chain-file").pipe(optionalFlag),
    "manifest-body-file-ios": Flag.String("manifest-body-file-ios").pipe(optionalFlag),
    "signature-file-ios": Flag.String("signature-file-ios").pipe(optionalFlag),
    "certificate-chain-file-ios": Flag.String("certificate-chain-file-ios").pipe(optionalFlag),
    "manifest-body-file-android": Flag.String("manifest-body-file-android").pipe(optionalFlag),
    "signature-file-android": Flag.String("signature-file-android").pipe(optionalFlag),
    "certificate-chain-file-android": Flag.String("certificate-chain-file-android").pipe(
      optionalFlag,
    ),
    "allow-dirty": Flag.Boolean("allow-dirty").pipe(
      Flag.withDescription("Proceed even with uncommitted git changes"),
      Flag.withDefault(false),
    ),
    "patch-base-window": optionalNonNegativeIntFlag(
      "patch-base-window",
      "Max recent published updates to compute bsdiff patches against (default 10; 0 = embedded baseline only)",
    ),
    patches: Flag.Boolean("patches").pipe(
      Flag.withDescription(
        "Generate bsdiff patches against recent published updates (default: on; pass --no-patches to skip the phase entirely) (--no-patches: Skip the bsdiff patch generation phase entirely (use --no-patches))",
      ),
      Flag.withDefault(true),
    ),
  },
  Effect.fn(
    function* (args) {
      const rolloutPercentage = args["rollout-percentage"]
        ? yield* parseRolloutPercentage(args["rollout-percentage"], "rollout-percentage")
        : undefined;

      const patchBaseWindow = args["patch-base-window"] ?? DEFAULT_PATCH_BASE_WINDOW;

      const result = yield* runUpdatePublish({
        branch: args.branch,
        channel: args.channel,
        platform: args.platform,
        message: args.message,
        auto: args.auto,
        environment: args.environment,
        profileName: args.profile,
        clear: args.clear,
        allowDirty: args["allow-dirty"],
        rolloutPercentage,
        inputDir: args["input-dir"],
        skipBundler: args["skip-bundler"],
        emitMetadata: args["emit-metadata"],
        noBytecode: args["no-bytecode"],
        sourceMaps: args["source-maps"],
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
        noPatches: !args.patches,
      });

      yield* printHuman(`Published update group ${result.groupId} to branch "${result.branch}".`);
      yield* printHuman("");
      yield* printHumanTable(
        ["Platform", "Update ID", "Runtime Version", "Uploaded", "Reused", "Patches", "Sourcemap"],
        result.results.map((entry) => [
          entry.platform,
          entry.updateId,
          entry.runtimeVersion,
          String(entry.uploadedAssets),
          String(entry.deduplicatedAssets),
          formatPatchesCell(entry.patches),
          entry.sourcemapStored ? "stored" : "—",
        ]),
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Publish a new OTA update group"));
