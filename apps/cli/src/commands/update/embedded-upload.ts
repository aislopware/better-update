import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEmbeddedUpload } from "../../application/embedded-upload";
import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";

// SHIP-DORMANT — this command is correct-by-construction for embedded-base
// patching but changes NOTHING for GA clients today. It pins the embedded
// baseline row id to the binary's app.manifest UUID and stores the launch-bundle
// BYTES as a diffable patch base, so that IF/when (a) expo ships its embedded-base
// patch opt-in AND (b) the CLI starts emitting embedded-base patches, the device's
// `expo-embedded-update-id` will finally MATCH a stored baseline + patch key.
// Until then the stored row is an unreferenced PK and the bytes are an unprobed
// base: no new header, manifest field, or endpoint is served to GA devices.
//
// BUILD-PIPELINE PREREQUISITE: better-update's build pipeline does NOT produce,
// read, or surface the app.manifest UUID — it is minted by expo-updates' own
// native build step (fresh-random per build, baked into the binary), so this
// command CANNOT derive it. The operator MUST extract it post-build and pass it
// via --embedded-id (iOS: <App>.app/EXUpdates.bundle/app.manifest `id`; Android:
// unzip the APK/AAB and read assets/app.manifest `id`) together with the matching
// --bundle bytes. A future enhancement could teach the build/export-embed step to
// persist the generated id as a build artifact this command auto-reads — that
// wiring does not exist today.
//
// DEVICE-VERIFY PREREQUISITE (human operator, NOT done here): before any
// embedded-base patch generation/serving is enabled, a real SDK-56 device (via
// the agent-device skill) must confirm (i) the exact lowercase app.manifest UUID
// the binary reports as expo-embedded-update-id matches the --embedded-id used at
// upload, and (ii) expo's embedded-base patch gating actually fires. This command
// does NOT claim GA-client functionality.

const EMBEDDED_UPLOAD_EXIT_EXTRAS = {
  RuntimeVersionError: 2,
  EnvExportError: 7,
  UpdatePublishError: 7,
} as const;

export const embeddedUploadCommand = defineCommand({
  meta: {
    name: "embedded:upload",
    description:
      "Register the native build's embedded launch bundle as a (currently-dormant) patch baseline, pinned to the binary's app.manifest UUID (isEmbedded update)",
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Platform the embedded bundle was built for",
      required: true,
    },
    bundle: {
      type: "string",
      description: "Path to the embedded launch bundle extracted from the native build",
      required: true,
    },
    "embedded-id": {
      type: "string",
      description:
        "The lowercase UUID from the native build app.manifest (id field). iOS: <App>.app/EXUpdates.bundle/app.manifest; Android: assets/app.manifest inside the APK/AAB. This is the value the device reports as expo-embedded-update-id.",
      required: true,
    },
    branch: { type: "string", description: "Target branch name" },
    channel: {
      type: "string",
      description: "Channel name to route the update through (resolves to branch)",
    },
    "runtime-version": {
      type: "string",
      description: "Runtime version (defaults to resolving from app config)",
    },
    message: { type: "string", description: "Optional update message" },
    environment: { type: "string", default: "production", description: "Env vars scope" },
    auto: {
      type: "boolean",
      description:
        "Skip prompts (for CI); infer the branch from the current git branch and the message from the latest commit subject",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const result = yield* runEmbeddedUpload({
          platform: args.platform,
          bundlePath: args.bundle,
          embeddedId: args["embedded-id"],
          branch: args.branch,
          channel: args.channel,
          runtimeVersion: args["runtime-version"],
          message: args.message,
          environment: args.environment,
          auto: args.auto ?? false,
        });

        yield* printHuman(
          `Registered embedded baseline under id ${result.updateId} (== the supplied --embedded-id) for ${result.platform} on branch "${result.branch}" (runtime ${result.runtimeVersion}).`,
        );
        yield* printHuman(
          result.reused
            ? "Launch bundle already present in storage — reused existing bytes."
            : "Uploaded embedded launch bundle bytes.",
        );
        return result;
      }),
      { exits: EMBEDDED_UPLOAD_EXIT_EXTRAS, json: "value" },
    ),
});
