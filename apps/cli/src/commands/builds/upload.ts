import { defineCommand } from "citty";

import { runUploadWorkflow } from "../../application/upload-workflow";
import { runEffect } from "../../lib/citty-effect";

const UPLOAD_EXIT_EXTRAS = {
  BuildProfileError: 2,
  RuntimeVersionError: 2,
  ArtifactNotFoundError: 6,
  BuildFailedError: 6,
  ReserveError: 7,
  UploadFailedError: 7,
  PresignedUrlExpiredError: 7,
  CompleteError: 7,
  EnvExportError: 7,
} as const;

export const uploadCommand = defineCommand({
  meta: { name: "upload", description: "Upload an existing artifact to better-update" },
  args: {
    "artifact-path": { type: "positional", required: true, description: "Path to artifact" },
    platform: { type: "enum", options: ["ios", "android"], required: true },
    profile: { type: "string", default: "production", description: "Build profile name" },
    message: { type: "string", description: "Optional build message" },
  },
  run: async ({ args }) =>
    runEffect(
      runUploadWorkflow({
        artifactPath: args["artifact-path"],
        platform: args.platform,
        profileName: args.profile,
        message: args.message,
      }),
      UPLOAD_EXIT_EXTRAS,
    ),
});
