import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  fetchDeveloperIdP12,
  resolveDeveloperIdCertificateId,
} from "../../application/macos-developer-id";
import { notarizeMacosArtifact, resolveNotaryAuth } from "../../application/macos-notarize";
import { runEffect } from "../../lib/citty-effect";
import { CodesignError } from "../../lib/exit-codes";
import { acquireKeychain } from "../../lib/ios-keychain";
import { signMacosApp, signMacosFile } from "../../lib/macos-signing";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { MACOS_EXIT_EXTRAS } from "./exits";

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

export const signCommand = defineCommand({
  meta: {
    name: "sign",
    description:
      "Code-sign a macOS .app bundle (or bare binary) with a vault-stored Developer ID Application certificate — hardened runtime + timestamp, nested code signed inside-out",
  },
  args: {
    app: {
      type: "positional",
      required: true,
      description: "Path to the .app bundle or Mach-O binary to sign",
    },
    "certificate-id": {
      type: "string",
      description:
        "Stored Developer ID certificate ID (from `credentials list`); picks/auto-detects when omitted",
    },
    entitlements: {
      type: "string",
      description: "Entitlements .plist applied to the outer bundle (or the bare binary)",
    },
    notarize: {
      type: "boolean",
      default: false,
      description: "Submit to the Apple notary service and staple after signing",
    },
    "asc-key-id": {
      type: "string",
      description: "ASC API key ID for --notarize (prompts to pick or create one if omitted)",
    },
    "apple-id": {
      type: "string",
      description:
        "Apple ID for --notarize password auth (reads $EXPO_APPLE_APP_SPECIFIC_PASSWORD; needs --team-id)",
    },
    "team-id": {
      type: "string",
      description: "10-character Apple team ID (required with --apple-id)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const targetPath = path.resolve(cwd, args.app);
        const shape = yield* classifySignTarget(targetPath);
        const entitlementsPath =
          args.entitlements === undefined || args.entitlements.length === 0
            ? undefined
            : path.resolve(cwd, args.entitlements);

        const certificateId = yield* resolveDeveloperIdCertificateId(api, args["certificate-id"]);
        const p12 = yield* fetchDeveloperIdP12(api, certificateId);

        const signed = yield* Effect.scoped(
          Effect.gen(function* () {
            const workDir = yield* Effect.acquireRelease(
              Effect.promise(async () => mkdtemp(path.join(tmpdir(), "better-update-macos-"))),
              (dir) => Effect.promise(async () => rm(dir, { recursive: true, force: true })),
            );
            const p12Path = path.join(workDir, "signing.p12");
            yield* Effect.promise(async () => writeFile(p12Path, p12.p12Bytes));
            const keychain = yield* acquireKeychain({
              tempDir: workDir,
              p12Path,
              p12Password: p12.p12Password,
            });
            yield* printHuman(`Signing with identity "${keychain.signingIdentity}"...`);
            const options = {
              appPath: targetPath,
              identity: keychain.signingIdentity,
              keychainPath: keychain.keychainPath,
              entitlementsPath,
            };
            const result =
              shape === "bundle" ? yield* signMacosApp(options) : yield* signMacosFile(options);
            return { identity: keychain.signingIdentity, ...result };
          }),
        );

        yield* printHuman("Signed and verified.");
        yield* printHumanKeyValue([
          ["Path", targetPath],
          ["Identity", signed.identity],
          ["Nested items signed", String(signed.signedNested.length)],
          ["Certificate", `${p12.serialNumber} (team ${p12.appleTeamIdentifier})`],
        ]);

        if (!args.notarize) {
          return {
            path: targetPath,
            identity: signed.identity,
            certificateId,
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
        });
        yield* printHumanKeyValue([
          ["Submission", notarization.submissionId ?? "-"],
          ["Status", notarization.status],
          ["Stapled", notarization.stapled ? "yes" : "no"],
        ]);
        return {
          path: targetPath,
          identity: signed.identity,
          certificateId,
          nestedSigned: signed.signedNested.length,
          notarization,
        };
      }),
      { exits: MACOS_EXIT_EXTRAS, json: "value" },
    ),
});
