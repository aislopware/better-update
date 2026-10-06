import path from "node:path";

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { distributeMacosApp } from "../../application/macos-distribute";
import { resolveNotaryAuth } from "../../application/macos-notarize";
import {
  acquireDeveloperIdIdentity,
  acquireMacosWorkDir,
} from "../../application/macos-signing-identity";
import { CodesignError } from "../../lib/exit-codes";
import { readBundleInfo } from "../../lib/macos-code-discovery";
import { auditDeveloperIdApp, formatAuditIssues } from "../../lib/macos-code-inspect";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

export const packageCommand = Command.make(
  "package",
  {
    app: Argument.String("app").pipe(
      Argument.withDescription("Path to the Developer ID-signed .app (see `macos sign`)"),
    ),
    format: Flag.Literals("format", ["dmg", "zip", "pkg", "tar.gz"]).pipe(
      Flag.withDescription(
        "Container: dmg (drag-to-install), zip (what Sparkle/Squirrel updaters consume), pkg (needs a Developer ID Installer certificate), or tar.gz (the .app.tar.gz the Tauri updater installs)",
      ),
      Flag.withDefault("dmg"),
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("Where to write the container (default: next to the app)"),
      optionalFlag,
    ),
    notarize: Flag.Boolean("notarize").pipe(
      Flag.withDescription(
        "Notarize and staple the result (--no-notarize to only package and sign)",
      ),
      Flag.withDefault(true),
    ),
    "certificate-id": Flag.String("certificate-id").pipe(
      Flag.withDescription(
        "Stored Developer ID Application certificate that signs the DMG; picks/auto-detects when omitted",
      ),
      optionalFlag,
    ),
    "installer-certificate-id": Flag.String("installer-certificate-id").pipe(
      Flag.withDescription(
        "Stored Developer ID Installer certificate for --format pkg; picks/auto-detects when omitted",
      ),
      optionalFlag,
    ),
    "asc-key-id": Flag.String("asc-key-id").pipe(
      Flag.withDescription("ASC API key ID for notarization (prompts to pick or create one)"),
      optionalFlag,
    ),
    "apple-id": Flag.String("apple-id").pipe(
      Flag.withDescription(
        "Apple ID for notarization password auth (reads $EXPO_APPLE_APP_SPECIFIC_PASSWORD; needs --team-id)",
      ),
      optionalFlag,
    ),
    "team-id": Flag.String("team-id").pipe(
      Flag.withDescription("10-character Apple team ID (required with --apple-id)"),
      optionalFlag,
    ),
    timeout: Flag.String("timeout").pipe(
      Flag.withDescription(
        'Stop waiting for notarization after this long (e.g. "30m"); the artifact is still written and `macos notarize --submission-id` resumes',
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const cwd = yield* runtime.cwd;
      const appPath = path.resolve(cwd, args.app).replace(/\/+$/u, "");
      const info = yield* readBundleInfo(appPath);
      if (info.bundleId === undefined) {
        return yield* new CodesignError({
          message: `"${appPath}" is not an .app bundle (no CFBundleIdentifier in Contents/Info.plist).`,
        });
      }
      const outputPath =
        args.output === undefined
          ? path.join(
              path.dirname(appPath),
              `${path.basename(appPath, ".app")}.${args.format === "tar.gz" ? "app.tar.gz" : args.format}`,
            )
          : path.resolve(cwd, args.output);

      const issues = yield* auditDeveloperIdApp(appPath);
      if (issues.length > 0) {
        return yield* new CodesignError({
          message: `The app is not ready for Developer ID distribution — sign it with \`better-update macos sign\` first:\n${formatAuditIssues(issues)}`,
        });
      }

      const notarize = args.notarize
        ? {
            auth: yield* resolveNotaryAuth(api, {
              ascKeyId: args["asc-key-id"],
              appleId: args["apple-id"],
              teamId: args["team-id"],
            }),
            timeout: args.timeout,
          }
        : undefined;
      const { bundleId } = info;

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const workDir = yield* acquireMacosWorkDir;
          const application = yield* acquireDeveloperIdIdentity(api, {
            kind: "DEVELOPER_ID_APPLICATION",
            certificateId: args["certificate-id"],
            workDir,
          });
          const installer =
            args.format === "pkg"
              ? yield* acquireDeveloperIdIdentity(api, {
                  kind: "DEVELOPER_ID_INSTALLER",
                  certificateId: args["installer-certificate-id"],
                  workDir,
                })
              : undefined;
          return yield* distributeMacosApp(api, {
            appPath,
            format: args.format,
            outputPath,
            workDir,
            bundleId,
            application,
            installer,
            notarize,
          });
        }),
      );

      yield* printHuman("");
      yield* printHumanKeyValue([
        ["Artifact", result.artifactPath],
        ["Format", result.format],
        ["Notarization", result.notarization?.status ?? "skipped"],
        ...(result.notarization === null
          ? []
          : ([
              ["Submission", result.notarization.submissionId],
              ["Stapled", result.notarization.stapled ? "yes" : "no"],
            ] as const)),
      ]);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Package a Developer ID-signed .app as a signed DMG, zip, pkg or .app.tar.gz, then notarize + staple it (only the outermost container is submitted)",
  ),
);
