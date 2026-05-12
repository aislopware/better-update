import { defineCommand } from "citty";

import { runBuildWorkflow } from "../../application/build-workflow";
import { runEffect } from "../../lib/citty-effect";
import { configureBuildCommand } from "./configure";

const BUILD_EXIT_EXTRAS = {
  BuildProfileError: 2,
  RuntimeVersionError: 2,
  MissingCredentialsError: 5,
  BuildFailedError: 6,
  KeychainError: 6,
  ProvisioningError: 6,
  ArtifactNotFoundError: 6,
  ReserveError: 7,
  UploadFailedError: 7,
  PresignedUrlExpiredError: 7,
  CompleteError: 7,
  EnvExportError: 7,
  DirtyRepoError: 3,
} as const;

export const buildCommand = defineCommand({
  meta: { name: "build", description: "Build the app locally and optionally upload" },
  subCommands: {
    configure: configureBuildCommand,
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Target platform (auto-detected from app.json when omitted)",
    },
    profile: { type: "string", default: "production", description: "Build profile name" },
    message: { type: "string", description: "Optional build message" },
    upload: {
      type: "boolean",
      default: true,
      description: "Upload the built artifact to better-update",
      negativeDescription: "Skip upload (use --no-upload)",
    },
    output: {
      type: "string",
      description: "Copy the built artifact to this path after completing the build",
    },
    "raw-output": { type: "boolean", description: "Stream raw Gradle/Xcode output" },
    "clear-cache": {
      type: "boolean",
      description: "Clear project-scoped build caches before building",
    },
    "freeze-credentials": {
      type: "boolean",
      description: "Fail fast if credentials missing instead of prompting (for CI)",
    },
    "allow-dirty": {
      type: "boolean",
      description: "Proceed even with uncommitted git changes",
    },
  },
  run: async ({ args }) =>
    runEffect(
      runBuildWorkflow({
        platform: args.platform,
        profileName: args.profile,
        message: args.message,
        noUpload: !args.upload,
        ...(args.output === undefined ? {} : { output: args.output }),
        rawOutput: args["raw-output"] ?? false,
        clearCache: args["clear-cache"] ?? false,
        freezeCredentials: args["freeze-credentials"] ?? false,
        allowDirty: args["allow-dirty"] ?? false,
      }),
      BUILD_EXIT_EXTRAS,
    ),
});
