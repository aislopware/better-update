/**
 * Everything `build --platform macos` does after the native build, whatever
 * produced the app: pre-flight audit (and repair, when the CLI can), package,
 * notarize, and the facts the uploaded build records under `metadata.macos`.
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type { MacosNotarization } from "@better-update/api";

import { execFailureDetail, runTool } from "../lib/exec-tool";
import { CodesignError, NotarizationError } from "../lib/exit-codes";
import { readMacosAppInfo } from "../lib/macos-app-info";
import { auditDeveloperIdApp, formatAuditIssues } from "../lib/macos-code-inspect";
import { hasStapledTicket, openAppInContainer } from "../lib/macos-container";
import { signMacosApp } from "../lib/macos-signing";
import { printHuman } from "../lib/output";
import { parsePlist } from "../lib/plist";
import { printWarn } from "../lib/warning-style";
import { pickOrCreateAscApiKey } from "./asc-key-resolve";
import { distributeMacosApp } from "./macos-distribute";
import { notarizeMacosArtifact } from "./macos-notarize";
import { appProfileNeeds, resolveDeveloperIdProfiles } from "./macos-provisioning";

import type { MacosBuildProduct } from "../commands/build/macos";
import type { MacosProfile } from "../lib/build-profile";
import type { MacosAppInfo } from "../lib/macos-app-info";
import type { MacosPackageFormat } from "../lib/macos-packaging";
import type { ApiClient } from "../services/api-client";
import type { MacosNotaryAuth, NotarizeMacosResult } from "./macos-notarize";
import type { DeveloperIdIdentity } from "./macos-signing-identity";

/**
 * Notary credentials for a build, settled before minutes of compiling: the
 * profile's `ascApiKeyId`, else the one stored key of the signing
 * certificate's own team (the only key that can be right, so no prompt), else
 * the interactive picker. A non-interactive run with no unambiguous key fails
 * with what to set.
 */
export const resolveBuildNotaryAuth = (
  api: ApiClient,
  params: { readonly profileKeyId: string | undefined; readonly teamId: string },
) =>
  Effect.gen(function* () {
    if (params.profileKeyId !== undefined) {
      return { kind: "asc-api-key", ascApiKeyId: params.profileKeyId } satisfies MacosNotaryAuth;
    }
    const [teams, keys] = yield* Effect.all([api.appleTeams.list(), api.ascApiKeys.list()], {
      concurrency: "unbounded",
    });
    const team = teams.items.find((candidate) => candidate.appleTeamId === params.teamId);
    const teamKeys = keys.items.filter((key) => team !== undefined && key.appleTeamId === team.id);
    const [lone] = teamKeys;
    if (teamKeys.length === 1 && lone !== undefined) {
      yield* printHuman(`Notarizing with ASC API key ${lone.name} (${lone.keyId})`);
      return { kind: "asc-api-key", ascApiKeyId: lone.id } satisfies MacosNotaryAuth;
    }
    const picked = yield* pickOrCreateAscApiKey(
      api,
      `Which ASC API key should notarize this build (team ${params.teamId})?`,
    );
    if (picked === null) {
      return yield* new NotarizationError({
        message:
          teamKeys.length === 0
            ? `No ASC API key stored for team ${params.teamId}. Add one with \`better-update credentials\`, set "macos.ascApiKeyId" in eas.json, or set "macos.notarize": false.`
            : `Several ASC API keys belong to team ${params.teamId}; set "macos.ascApiKeyId" in eas.json to pick one.`,
      });
    }
    return { kind: "asc-api-key", ascApiKeyId: picked } satisfies MacosNotaryAuth;
  });

export interface FinishMacosBuildOptions {
  readonly product: MacosBuildProduct;
  readonly profile: MacosProfile;
  readonly projectRoot: string;
  readonly workDir: string;
  readonly application: DeveloperIdIdentity;
  readonly installer: DeveloperIdIdentity | undefined;
  readonly notaryAuth: MacosNotaryAuth | undefined;
}

export interface FinishedMacosBuild {
  readonly artifactPath: string;
  readonly format: MacosPackageFormat;
  readonly appInfo: MacosAppInfo;
  readonly notarization: MacosNotarization;
}

const notarizationState = (result: NotarizeMacosResult | null): MacosNotarization => {
  if (result === null) {
    return { status: "skipped", stapled: false };
  }
  return {
    status: result.timedOut ? "pending" : "accepted",
    submissionId: result.submissionId,
    stapled: result.stapled,
  };
};

/** The ASC API key that may create a missing profile: the notary key, else the same resolution. */
const profileAscKeyId = (api: ApiClient, options: FinishMacosBuildOptions) =>
  options.notaryAuth?.kind === "asc-api-key"
    ? Effect.succeed(options.notaryAuth.ascApiKeyId)
    : resolveBuildNotaryAuth(api, {
        profileKeyId: options.profile.ascApiKeyId,
        teamId: options.application.teamId,
      }).pipe(Effect.map((auth) => auth.ascApiKeyId));

const readPlistFile = (filePath: string) =>
  Effect.promise(async () => parsePlist(await readFile(filePath)));

/**
 * Audit, and when the app fails it, re-sign it with the CLI signer and audit
 * again. Repair covers what toolchains commonly get wrong — unsigned or
 * linker-signed sidecars, no hardened runtime, no secure timestamp,
 * `get-task-allow` left in — so a build fails only on what re-signing cannot
 * fix (a restricted entitlement without its profile).
 */
const auditOrRepair = (api: ApiClient, options: FinishMacosBuildOptions, appPath: string) =>
  Effect.gen(function* () {
    const expected = { expectedTeamId: options.application.teamId };
    const issues = yield* auditDeveloperIdApp(appPath, expected);
    if (issues.length === 0) {
      return;
    }
    yield* printWarn(
      `Re-signing ${path.basename(appPath)} — it is not ready for Developer ID distribution:\n${formatAuditIssues(issues)}`,
    );
    const entitlementsPath =
      options.profile.entitlements === undefined
        ? undefined
        : path.resolve(options.projectRoot, options.profile.entitlements);
    const needs = yield* appProfileNeeds(
      appPath,
      entitlementsPath === undefined ? undefined : yield* readPlistFile(entitlementsPath),
    );
    const provisioningProfiles =
      needs.length === 0
        ? undefined
        : yield* resolveDeveloperIdProfiles(api, {
            needs,
            identity: options.application,
            workDir: options.workDir,
            ascApiKeyId: profileAscKeyId(api, options),
          });
    yield* signMacosApp({
      appPath,
      identity: options.application.hash,
      keychainPath: options.application.keychainPath,
      workDir: options.workDir,
      ...compact({ entitlementsPath, provisioningProfiles }),
    });
    const remaining = yield* auditDeveloperIdApp(appPath, expected);
    if (remaining.length > 0) {
      return yield* new CodesignError({
        message: `${path.basename(appPath)} still fails the Developer ID checks after re-signing:\n${formatAuditIssues(remaining)}`,
      });
    }
  });

const finishApp = (
  api: ApiClient,
  options: FinishMacosBuildOptions,
  appPath: string,
  format: MacosPackageFormat = options.profile.artifact,
) =>
  Effect.gen(function* () {
    yield* auditOrRepair(api, options, appPath);
    const appInfo = yield* readMacosAppInfo(appPath);
    const bundleId = appInfo.bundleId ?? options.profile.metaOverride?.bundleIdentifier;
    if (bundleId === undefined) {
      return yield* new CodesignError({
        message: `${path.basename(appPath)} has no CFBundleIdentifier; set macos.bundleIdentifier in eas.json.`,
      });
    }
    const name = path.basename(appPath, ".app");
    const version = appInfo.version === undefined ? "" : `-${appInfo.version}`;
    const result = yield* distributeMacosApp(api, {
      appPath,
      format,
      outputPath: path.join(
        options.workDir,
        `${name}${version}.${format === "tar.gz" ? "app.tar.gz" : format}`,
      ),
      workDir: options.workDir,
      bundleId,
      application: options.application,
      installer: options.installer,
      notarize:
        options.notaryAuth === undefined
          ? undefined
          : { auth: options.notaryAuth, timeout: options.profile.notarizeTimeout },
    });
    return {
      artifactPath: result.artifactPath,
      format,
      appInfo,
      notarization: notarizationState(result.notarization),
    } satisfies FinishedMacosBuild;
  });

/** A DMG may ship unsigned from some tools; sign it so Gatekeeper names its origin. */
const ensureSignedContainer = (
  options: FinishMacosBuildOptions,
  product: Extract<MacosBuildProduct, { readonly kind: "container" }>,
  bundleId: string | undefined,
) =>
  Effect.gen(function* () {
    if (product.format === "pkg") {
      const check = yield* runTool("pkgutil", ["--check-signature", product.path]);
      if (check.exitCode !== 0 || !check.stdout.includes("Developer ID Installer")) {
        return yield* new CodesignError({
          message: `${path.basename(product.path)} is not signed with a Developer ID Installer certificate; have the build sign it (productbuild --sign) or point artifactPath at the .app and set "macos.artifact": "pkg".`,
        });
      }
      return;
    }
    if (product.format === "zip") {
      return;
    }
    const verify = yield* runTool("codesign", ["--verify", product.path]);
    if (verify.exitCode === 0) {
      return;
    }
    yield* printHuman(`Signing ${path.basename(product.path)}...`);
    const sign = yield* runTool("codesign", [
      "--sign",
      options.application.hash,
      "--keychain",
      options.application.keychainPath,
      "--timestamp",
      ...(bundleId === undefined ? [] : ["--identifier", `${bundleId}.dmg`]),
      product.path,
    ]);
    if (sign.exitCode !== 0) {
      return yield* new CodesignError({
        message: `codesign failed on ${path.basename(product.path)}: ${execFailureDetail(sign)}`,
      });
    }
  });

/**
 * A container a custom tool packaged: audit the app inside (it cannot be
 * repaired without repackaging, so problems fail the build with the fix),
 * make sure the container itself is signed, then notarize it unless the tool
 * already stapled a ticket.
 */
const finishContainer = (
  api: ApiClient,
  options: FinishMacosBuildOptions,
  product: Extract<MacosBuildProduct, { readonly kind: "container" }>,
) =>
  Effect.gen(function* () {
    if (product.format !== options.profile.artifact) {
      yield* printWarn(
        `The custom build produced a .${product.format}; "macos.artifact" (${options.profile.artifact}) applies only when artifactPath names the .app.`,
      );
    }
    const appInfo = yield* Effect.scoped(
      Effect.gen(function* () {
        const appPath = yield* openAppInContainer({
          containerPath: product.path,
          format: product.format,
          workDir: options.workDir,
        });
        const issues = yield* auditDeveloperIdApp(appPath, {
          expectedTeamId: options.application.teamId,
        });
        if (issues.length > 0) {
          return yield* new CodesignError({
            message: `The app inside ${path.basename(product.path)} is not ready for Developer ID distribution — point artifactPath at the .app so the CLI can re-sign and package it:\n${formatAuditIssues(issues)}`,
          });
        }
        return yield* readMacosAppInfo(appPath);
      }),
    );
    yield* ensureSignedContainer(options, product, appInfo.bundleId);
    if (yield* hasStapledTicket(product.path)) {
      yield* printHuman(`${path.basename(product.path)} already carries a notarization ticket.`);
      return {
        artifactPath: product.path,
        format: product.format,
        appInfo,
        notarization: { status: "accepted", stapled: true },
      } satisfies FinishedMacosBuild;
    }
    const result =
      options.notaryAuth === undefined
        ? null
        : yield* notarizeMacosArtifact(api, {
            artifactPath: product.path,
            auth: options.notaryAuth,
            wait: true,
            staple: true,
            timeout: options.profile.notarizeTimeout,
          });
    return {
      artifactPath: product.path,
      format: product.format,
      appInfo,
      notarization: notarizationState(result),
    } satisfies FinishedMacosBuild;
  });

/**
 * A `.app.tar.gz` a tool made (Tauri's updater bundle) holds the app as-is,
 * so it is unpacked and finished like an `.app` — re-signed if needed,
 * notarized, stapled and archived again — rather than shipped unnotarized.
 */
const finishTarball = (api: ApiClient, options: FinishMacosBuildOptions, tarballPath: string) =>
  Effect.gen(function* () {
    const root = path.join(options.workDir, "unpacked-tarball");
    yield* Effect.promise(async () => mkdir(root, { recursive: true }));
    const unpacked = yield* runTool("tar", ["-xzf", tarballPath, "-C", root]);
    const entries = yield* Effect.promise(async () => readdir(root));
    const appName = entries.find((entry) => entry.endsWith(".app"));
    if (unpacked.exitCode !== 0 || appName === undefined) {
      return yield* new CodesignError({
        message: `${path.basename(tarballPath)} holds no .app at its top level${unpacked.exitCode === 0 ? "" : `: ${execFailureDetail(unpacked)}`}.`,
      });
    }
    return yield* finishApp(api, options, path.join(root, appName), "tar.gz");
  });

export const finishMacosBuild = (api: ApiClient, options: FinishMacosBuildOptions) =>
  Effect.gen(function* () {
    const { product } = options;
    if (product.kind === "app") {
      return yield* finishApp(api, options, product.path);
    }
    return product.format === "tar.gz"
      ? yield* finishTarball(api, options, product.path)
      : yield* finishContainer(api, options, product);
  });
