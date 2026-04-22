import { defineCommand } from "citty";

import { runBuildWorkflow } from "../../application/build-workflow";
import { runEffect } from "../../lib/citty-effect";

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
} as const;

export const buildCommand = defineCommand({
  meta: { name: "build", description: "Build the app locally and optionally upload" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], required: true },
    profile: { type: "string", default: "production", description: "Build profile name" },
    message: { type: "string", description: "Optional build message" },
    upload: {
      type: "boolean",
      default: true,
      description: "Upload the built artifact to better-update",
      negativeDescription: "Skip upload (use --no-upload)",
    },
    "raw-output": { type: "boolean", description: "Stream raw Gradle/Xcode output" },
  },
  run: async ({ args }) =>
    runEffect(
      runBuildWorkflow({
        platform: args.platform,
        profileName: args.profile,
        message: args.message,
        noUpload: !args.upload,
        rawOutput: args["raw-output"] ?? false,
      }),
      BUILD_EXIT_EXTRAS,
    ),
});
