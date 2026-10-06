import { stat } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { notarizeMacosArtifact, resolveNotaryAuth } from "../../application/macos-notarize";
import {
  acquireDeveloperIdIdentity,
  acquireMacosWorkDir,
} from "../../application/macos-signing-identity";
import { CodesignError } from "../../lib/exit-codes";
import { auditDeveloperIdApp, formatAuditIssues } from "../../lib/macos-code-inspect";
import { signMacosApp, signMacosFile } from "../../lib/macos-signing";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

type TargetShape = "bundle" | "file";

/** `.app` directories get the inside-out walk; a bare Mach-O signs directly. */
const classifySignTarget = (targetPath: string) =>
  Effect.gen(function* () {
    const info = yield* Effect.tryPromise({
      try: async () => stat(targetPath),
      catch: () => new CodesignError({ message: `No such file or directory: ${targetPath}` }),
    });
    if (info.isDirectory()) {
      if (!targetPath.toLowerCase().replace(/\/+$/u, "").endsWith(".app")) {
        return yield* new CodesignError({
          message: `"${targetPath}" is a directory but not an .app bundle — point at the .app, or at a single binary.`,
        });
      }
      return "bundle" satisfies TargetShape;
    }
    return "file" satisfies TargetShape;
  });

export const signCommand = Command.make(
  "sign",
  {
    app: Argument.String("app").pipe(
      Argument.withDescription("Path to the .app bundle or Mach-O binary to sign"),
    ),
    "certificate-id": Flag.String("certificate-id").pipe(
      Flag.withDescription(
        "Stored Developer ID certificate ID (from `credentials list`); picks/auto-detects when omitted",
      ),
      optionalFlag,
    ),
    entitlements: Flag.String("entitlements").pipe(
      Flag.withDescription("Entitlements .plist applied to the outer bundle (or the bare binary)"),
      optionalFlag,
    ),
    notarize: Flag.Boolean("notarize").pipe(
      Flag.withDescription("Submit to the Apple notary service and staple after signing"),
      Flag.withDefault(false),
    ),
    "asc-key-id": Flag.String("asc-key-id").pipe(
      Flag.withDescription(
        "ASC API key ID for --notarize (prompts to pick or create one if omitted)",
      ),
      optionalFlag,
    ),
    "apple-id": Flag.String("apple-id").pipe(
      Flag.withDescription(
        "Apple ID for --notarize password auth (reads $EXPO_APPLE_APP_SPECIFIC_PASSWORD; needs --team-id)",
      ),
      optionalFlag,
    ),
    "team-id": Flag.String("team-id").pipe(
      Flag.withDescription("10-character Apple team ID (required with --apple-id)"),
      optionalFlag,
    ),
    "notarize-timeout": Flag.String("notarize-timeout").pipe(
      Flag.withDescription(
        'With --notarize: stop waiting after this long (e.g. "30m"); resume with `macos notarize --submission-id`',
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const cwd = yield* runtime.cwd;
      const targetPath = path.resolve(cwd, args.app);
      const shape = yield* classifySignTarget(targetPath);
      const entitlementsPath =
        args.entitlements === undefined || args.entitlements.length === 0
          ? undefined
          : path.resolve(cwd, args.entitlements);

      const signed = yield* Effect.scoped(
        Effect.gen(function* () {
          const workDir = yield* acquireMacosWorkDir;
          const identity = yield* acquireDeveloperIdIdentity(api, {
            kind: "DEVELOPER_ID_APPLICATION",
            certificateId: args["certificate-id"],
            workDir,
          });
          yield* printHuman(`Signing with identity "${identity.name}"...`);
          const options = {
            appPath: targetPath,
            identity: identity.hash,
            keychainPath: identity.keychainPath,
            entitlementsPath,
            workDir,
          };
          const result =
            shape === "bundle" ? yield* signMacosApp(options) : yield* signMacosFile(options);
          return { identity, ...result };
        }),
      );
      const { identity } = signed;

      // Catch what the notary would reject before a submission that can take
      // hours: runtime, timestamp, identity, get-task-allow, unprofiled
      // restricted entitlements.
      if (shape === "bundle") {
        const issues = yield* auditDeveloperIdApp(targetPath, { expectedTeamId: identity.teamId });
        if (issues.length > 0) {
          return yield* new CodesignError({
            message: `Signed, but not ready for Developer ID distribution:\n${formatAuditIssues(issues)}`,
          });
        }
      }

      yield* printHuman("Signed and verified.");
      yield* printHumanKeyValue([
        ["Path", targetPath],
        ["Identity", identity.name],
        ["Nested items signed", String(signed.signedNested.length)],
        ["Certificate", `${identity.serialNumber} (team ${identity.teamId})`],
      ]);

      if (!args.notarize) {
        return {
          path: targetPath,
          identity: identity.name,
          certificateId: identity.certificateId,
          nestedSigned: signed.signedNested.length,
          notarization: null,
        };
      }

      const auth = yield* resolveNotaryAuth(api, {
        ascKeyId: args["asc-key-id"],
        appleId: args["apple-id"],
        teamId: args["team-id"],
      });
      const notarization = yield* notarizeMacosArtifact(api, {
        artifactPath: targetPath,
        auth,
        wait: true,
        staple: true,
        timeout: args["notarize-timeout"],
      });
      yield* printHumanKeyValue([
        ["Submission", notarization.submissionId],
        ["Status", notarization.status],
        ["Stapled", notarization.stapled ? "yes" : "no"],
      ]);
      return {
        path: targetPath,
        identity: identity.name,
        certificateId: identity.certificateId,
        nestedSigned: signed.signedNested.length,
        notarization,
      };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Code-sign a macOS .app bundle (or bare binary) with a vault-stored Developer ID Application certificate — hardened runtime + timestamp, nested code signed inside-out",
  ),
);
