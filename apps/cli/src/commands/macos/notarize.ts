import path from "node:path";

import { defineCommand } from "citty";
import { Effect } from "effect";

import { notarizeMacosArtifact, resolveNotaryAuth } from "../../application/macos-notarize";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { MACOS_EXIT_EXTRAS } from "./exits";

export const notarizeCommand = defineCommand({
  meta: {
    name: "notarize",
    description:
      "Notarize a signed macOS artifact (.app is zipped automatically; .dmg/.pkg/.zip upload as-is) and staple the ticket",
  },
  args: {
    path: {
      type: "positional",
      required: true,
      description: "Path to the signed .app, .dmg, .pkg, or .zip",
    },
    "asc-key-id": {
      type: "string",
      description:
        "ASC API key ID (from `credentials list`); prompts to pick or create one if omitted",
    },
    "apple-id": {
      type: "string",
      description:
        "Apple ID for password auth (reads $EXPO_APPLE_APP_SPECIFIC_PASSWORD; needs --team-id)",
    },
    "team-id": {
      type: "string",
      description: "10-character Apple team ID (required with --apple-id)",
    },
    wait: {
      type: "boolean",
      default: true,
      description: "Wait for Apple's verdict (disable to just upload and return the submission id)",
    },
    staple: {
      type: "boolean",
      default: true,
      description: "Staple the ticket to the artifact after acceptance (skipped for .zip)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const artifactPath = path.resolve(cwd, args.path);
        const auth = yield* resolveNotaryAuth(api, {
          ascKeyId: args["asc-key-id"],
          appleId: args["apple-id"],
          teamId: args["team-id"],
        });
        const result = yield* notarizeMacosArtifact(api, {
          artifactPath,
          auth,
          wait: args.wait,
          staple: args.staple,
        });
        yield* printHuman("");
        yield* printHumanKeyValue([
          ["Path", result.artifactPath],
          ["Submission", result.submissionId ?? "-"],
          ["Status", result.status],
          ["Stapled", result.stapled ? "yes" : "no"],
        ]);
        return result;
      }),
      { exits: MACOS_EXIT_EXTRAS, json: "value" },
    ),
});
