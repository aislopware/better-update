/**
 * Turn a signed `.app` into a distributable artifact, notarized in the order
 * Apple prescribes for each container:
 *
 * - dmg / pkg — build and sign the container, notarize only that outermost
 *   container (the service tickets the nested app too), staple it.
 * - zip / tar.gz — an archive cannot carry a ticket, so notarize the app
 *   itself, staple the ticket into the `.app`, then archive the stapled app.
 *
 * A notarization that outlives `timeout` is not a failure: the artifact is
 * still produced (signed, ticket pending at Apple) and the result says so,
 * with the submission id to resume and staple later.
 */
import path from "node:path";

import { Effect } from "effect";

import { CodesignError } from "../lib/exit-codes";
import { createSignedDmg, createSignedPkg, tarApp, zipApp } from "../lib/macos-packaging";
import { printHuman } from "../lib/output";
import { notarizeMacosArtifact } from "./macos-notarize";

import type { MacosPackageFormat } from "../lib/macos-packaging";
import type { ApiClient } from "../services/api-client";
import type { MacosNotaryAuth, NotarizeMacosResult } from "./macos-notarize";
import type { DeveloperIdIdentity } from "./macos-signing-identity";

export interface DistributeMacosAppOptions {
  readonly appPath: string;
  readonly format: MacosPackageFormat;
  readonly outputPath: string;
  readonly workDir: string;
  /** CFBundleIdentifier — the DMG's signing identifier derives from it. */
  readonly bundleId: string;
  /** Signs the DMG (and already signed the app). */
  readonly application: DeveloperIdIdentity;
  /** Required for `pkg`. */
  readonly installer: DeveloperIdIdentity | undefined;
  /** `undefined` skips notarization (the artifact is signed only). */
  readonly notarize:
    | { readonly auth: MacosNotaryAuth; readonly timeout: string | undefined }
    | undefined;
}

export interface DistributeMacosAppResult {
  readonly artifactPath: string;
  readonly format: MacosPackageFormat;
  readonly notarization: NotarizeMacosResult | null;
}

const notarize = (
  api: ApiClient,
  artifactPath: string,
  settings: NonNullable<DistributeMacosAppOptions["notarize"]>,
) =>
  notarizeMacosArtifact(api, {
    artifactPath,
    auth: settings.auth,
    wait: true,
    staple: true,
    timeout: settings.timeout,
  });

const packageContainer = (options: DistributeMacosAppOptions) =>
  Effect.gen(function* () {
    if (options.format === "dmg") {
      yield* printHuman(`Creating ${path.basename(options.outputPath)}...`);
      yield* createSignedDmg({
        appPath: options.appPath,
        outputPath: options.outputPath,
        volumeName: path.basename(options.appPath, ".app"),
        workDir: options.workDir,
        identity: options.application.hash,
        keychainPath: options.application.keychainPath,
        identifier: `${options.bundleId}.dmg`,
      });
      return;
    }
    if (options.installer === undefined) {
      return yield* new CodesignError({
        message: "A .pkg needs a Developer ID Installer certificate.",
      });
    }
    yield* printHuman(`Creating ${path.basename(options.outputPath)}...`);
    yield* createSignedPkg({
      appPath: options.appPath,
      outputPath: options.outputPath,
      installerIdentity: options.installer.hash,
      keychainPath: options.installer.keychainPath,
    });
  });

export const distributeMacosApp = (api: ApiClient, options: DistributeMacosAppOptions) =>
  Effect.gen(function* () {
    if (options.format === "zip" || options.format === "tar.gz") {
      const notarization =
        options.notarize === undefined
          ? null
          : yield* notarize(api, options.appPath, options.notarize);
      yield* printHuman(`Creating ${path.basename(options.outputPath)}...`);
      yield* options.format === "zip"
        ? zipApp(options.appPath, options.outputPath)
        : tarApp(options.appPath, options.outputPath);
      return {
        artifactPath: options.outputPath,
        format: options.format,
        notarization,
      } satisfies DistributeMacosAppResult;
    }
    yield* packageContainer(options);
    const notarization =
      options.notarize === undefined
        ? null
        : yield* notarize(api, options.outputPath, options.notarize);
    return {
      artifactPath: options.outputPath,
      format: options.format,
      notarization,
    } satisfies DistributeMacosAppResult;
  });
