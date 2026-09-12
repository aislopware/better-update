import path from "node:path";

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { notarizeMacosArtifact, resolveNotaryAuth } from "../../application/macos-notarize";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

export const notarizeCommand = Command.make(
  "notarize",
  {
    path: Argument.String("path").pipe(
      Argument.withDescription("Path to the signed .app, .dmg, .pkg, or .zip"),
    ),
    "asc-key-id": Flag.String("asc-key-id").pipe(
      Flag.withDescription(
        "ASC API key ID (from `credentials list`); prompts to pick or create one if omitted",
      ),
      optionalFlag,
    ),
    "apple-id": Flag.String("apple-id").pipe(
      Flag.withDescription(
        "Apple ID for password auth (reads $EXPO_APPLE_APP_SPECIFIC_PASSWORD; needs --team-id)",
      ),
      optionalFlag,
    ),
    "team-id": Flag.String("team-id").pipe(
      Flag.withDescription("10-character Apple team ID (required with --apple-id)"),
      optionalFlag,
    ),
    wait: Flag.Boolean("wait").pipe(
      Flag.withDescription(
        "Wait for Apple's verdict (disable to just upload and return the submission id)",
      ),
      Flag.withDefault(true),
    ),
    staple: Flag.Boolean("staple").pipe(
      Flag.withDescription("Staple the ticket to the artifact after acceptance (skipped for .zip)"),
      Flag.withDefault(true),
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Notarize a signed macOS artifact (.app is zipped automatically; .dmg/.pkg/.zip upload as-is) and staple the ticket",
  ),
);
