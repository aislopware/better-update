/**
 * The update signatures `<platform> release create` computes locally —
 * Sparkle's and WinSparkle's EdDSA and the Tauri updater's minisign — and
 * where it finds their keys: a key-file flag, then the process environment,
 * then the `--environment`'s variables (pulled at most once). Keys never
 * leave this machine; only the signatures are uploaded.
 */
import { readDesktopBuildMetadata, readMacosBuildMetadata } from "@better-update/api";
import { FileSystem, Effect } from "effect";

import type { BuildWithArtifact } from "@better-update/api";

import { pullEnvVars } from "../lib/env-exporter";
import { InvalidArgumentError } from "../lib/exit-codes";
import {
  parseSparklePrivateKey,
  signSparkleArchive,
  sparklePublicKeyBase64,
  verifySparkleSignature,
} from "../lib/sparkle-signature";
import {
  parseTauriPrivateKey,
  parseTauriPublicKey,
  signTauriArchive,
  tauriKeysMatch,
  tauriPublicKeyText,
  verifyTauriSignature,
} from "../lib/tauri-signature";
import { printWarn } from "../lib/warning-style";
import { CliRuntime } from "../services/cli-runtime";

import type { EdKeyKind } from "../lib/sparkle-signature";
import type { ApiClient } from "../services/api-client";

export const SPARKLE_PRIVATE_KEY_ENV = "SPARKLE_PRIVATE_KEY";
export const WINSPARKLE_PRIVATE_KEY_ENV = "WINSPARKLE_PRIVATE_KEY";
/** Tauri's own variables, so a project's existing CI secrets work unchanged. */
export const TAURI_PRIVATE_KEY_ENV = "TAURI_SIGNING_PRIVATE_KEY";
export const TAURI_KEY_PASSWORD_ENV = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD";

/** Tauri semver, as its updater parses `version` (a leading `v` allowed). */
const SEMVER =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * A lookup of a setting by name: the process environment first, then the
 * `environment`'s variables (pulled on first use, at most once).
 */
export const releaseSettings = (
  api: ApiClient,
  params: { readonly projectId: string; readonly environment: string | undefined },
) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const { environment } = params;
    const vaultVars = yield* Effect.cached(
      environment === undefined
        ? Effect.succeed<Record<string, string>>({})
        : pullEnvVars(api, { projectId: params.projectId, environment }),
    );
    return (name: string) =>
      Effect.gen(function* () {
        const fromProcess = yield* runtime.getEnv(name);
        if (fromProcess !== undefined && fromProcess.trim() !== "") {
          return fromProcess;
        }
        return (yield* vaultVars)[name];
      });
  });

export type ReleaseSetting = Effect.Success<ReturnType<typeof releaseSettings>>;

const readKeyFile = (flag: string, file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(file).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidArgumentError({
            message: `Could not read ${flag} "${file}": ${String(cause)}`,
          }),
      ),
    );
  });

/** What one updater's EdDSA signing needs to know, so Sparkle and WinSparkle share it. */
interface EdUpdater {
  readonly kind: EdKeyKind;
  readonly flag: string;
  readonly envVar: string;
  /** Where the app keeps the public key, as the error names it. */
  readonly publicKeyName: string;
}

const SPARKLE: EdUpdater = {
  kind: { name: "Sparkle", exportHint: "`generate_keys -x <file>`" },
  flag: "--sparkle-key-file",
  envVar: SPARKLE_PRIVATE_KEY_ENV,
  publicKeyName: "SUPublicEDKey",
};

const WINSPARKLE: EdUpdater = {
  kind: { name: "WinSparkle", exportHint: "`winsparkle-tool generate-key --file <file>`" },
  flag: "--winsparkle-key-file",
  envVar: WINSPARKLE_PRIVATE_KEY_ENV,
  publicKeyName: "the EdDSAPub resource",
};

/**
 * An EdDSA signature over the file with `updater`'s key, or undefined when
 * there is none. Refuses a release the app would reject: unsigned while the
 * app names a public key, or signed by a key other than that one.
 */
const edSignature = (
  updater: EdUpdater,
  params: {
    readonly bytes: Uint8Array;
    readonly keyFile: string | undefined;
    readonly setting: ReleaseSetting;
    readonly appPublicKey: string | undefined;
  },
) =>
  Effect.gen(function* () {
    const keyText =
      params.keyFile === undefined
        ? yield* params.setting(updater.envVar)
        : yield* readKeyFile(updater.flag, params.keyFile);
    const { appPublicKey } = params;
    if (keyText === undefined) {
      if (appPublicKey !== undefined) {
        return yield* new InvalidArgumentError({
          message: `The app verifies updates with ${updater.kind.name} public key ${appPublicKey}, so an unsigned release would be rejected. Provide the private key (${updater.kind.exportHint}) via ${updater.flag}, $${updater.envVar}, or ${updater.envVar} in the --environment's variables.`,
        });
      }
      return undefined;
    }
    const key = parseSparklePrivateKey(keyText, updater.kind);
    if (typeof key === "string") {
      return yield* new InvalidArgumentError({ message: key });
    }
    const publicKey = sparklePublicKeyBase64(key);
    if (appPublicKey !== undefined && appPublicKey !== publicKey) {
      return yield* new InvalidArgumentError({
        message: `The ${updater.kind.name} private key belongs to public key ${publicKey}, but the app verifies updates with ${updater.publicKeyName} ${appPublicKey}; the app would reject this release.`,
      });
    }
    const signature = signSparkleArchive(key, params.bytes);
    if (!verifySparkleSignature(publicKey, signature, params.bytes)) {
      return yield* new InvalidArgumentError({
        message: `The ${updater.kind.name} signature does not verify against its own key; the key is corrupt.`,
      });
    }
    return signature;
  });

interface SignatureParams {
  readonly build: BuildWithArtifact;
  readonly bytes: Uint8Array;
  readonly keyFile: string | undefined;
  readonly setting: ReleaseSetting;
}

/** A macOS archive's `sparkle:edSignature`, or undefined for an unsigned release. */
export const sparkleSignature = (params: SignatureParams) =>
  Effect.gen(function* () {
    const signature = yield* edSignature(SPARKLE, {
      ...params,
      appPublicKey: readMacosBuildMetadata(params.build.metadataJson)?.sparklePublicKey,
    });
    // A Tauri archive's app updates through Tauri, not Sparkle: nothing to warn about.
    if (signature === undefined && params.build.artifact?.format !== "tar.gz") {
      yield* printWarn(
        `No Sparkle private key: the appcast item carries no EdDSA signature. That suits electron-updater feeds; a Sparkle 2 app accepts only signed updates (pass --sparkle-key-file or set $${SPARKLE_PRIVATE_KEY_ENV}).`,
      );
    }
    return signature;
  });

/**
 * A Windows installer's WinSparkle `sparkle:edSignature`, or undefined when
 * there is no key — an Electron or Tauri app has none, and needs none.
 */
export const winSparkleSignature = (params: SignatureParams) =>
  edSignature(WINSPARKLE, {
    ...params,
    appPublicKey: readDesktopBuildMetadata("windows", params.build.metadataJson)
      ?.winSparklePublicKey,
  });

/** Tauri reads its key variable as the key itself or a path to it; so does the CLI. */
const keyOrPath = (value: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const isFile = yield* fs.exists(value.trim()).pipe(Effect.orElseSucceed(() => false));
    return isFile ? yield* readKeyFile(`$${TAURI_PRIVATE_KEY_ENV}`, value.trim()) : value;
  });

const readTauriKeyText = (params: SignatureParams) =>
  Effect.gen(function* () {
    if (params.keyFile !== undefined) {
      return yield* readKeyFile("--tauri-key-file", params.keyFile);
    }
    const fromSetting = yield* params.setting(TAURI_PRIVATE_KEY_ENV);
    return fromSetting === undefined ? undefined : yield* keyOrPath(fromSetting);
  });

/** The decrypted key, checked against the `pubkey` the app was built with. */
const tauriKey = (keyText: string, appPublicKeyText: string | undefined, setting: ReleaseSetting) =>
  Effect.gen(function* () {
    // Tauri's own default when no password is set (its CLI assumes an empty one off a terminal).
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- an empty password is minisign's "no password", not missing data
    const password = (yield* setting(TAURI_KEY_PASSWORD_ENV)) ?? "";
    const key = parseTauriPrivateKey(keyText, password);
    if (typeof key === "string") {
      return yield* new InvalidArgumentError({ message: key });
    }
    const appPublicKey =
      appPublicKeyText === undefined ? undefined : parseTauriPublicKey(appPublicKeyText);
    if (appPublicKey !== undefined && !tauriKeysMatch(key, appPublicKey)) {
      return yield* new InvalidArgumentError({
        message: `The Tauri private key is not the one the app's updater pubkey names (the key's pubkey is ${tauriPublicKeyText(key)}); the app would reject this release.`,
      });
    }
    return key;
  });

/** The formats the Tauri updater installs, per platform. */
const TAURI_FORMATS = new Set(["tar.gz", "exe", "msi", "appimage", "deb", "rpm"]);

/** What the app embeds and how Tauri's signer names the file in its trusted comment. */
const tauriTarget = (build: BuildWithArtifact) => {
  const format = build.artifact?.format;
  if (format === undefined || !TAURI_FORMATS.has(format)) {
    return undefined;
  }
  if (build.platform === "macos") {
    const metadata = readMacosBuildMetadata(build.metadataJson);
    return {
      publicKey: metadata?.tauriPublicKey,
      fileName: `${metadata?.appName ?? "app"}.app.tar.gz`,
    };
  }
  if (build.platform !== "windows" && build.platform !== "linux") {
    return undefined;
  }
  const metadata = readDesktopBuildMetadata(build.platform, build.metadataJson);
  const extension = format === "appimage" ? "AppImage" : format;
  return {
    publicKey: metadata?.tauriPublicKey,
    fileName: `${metadata?.appName ?? "app"}_${build.appVersion ?? "0.0.0"}.${extension}`,
  };
};

/**
 * The Tauri updater `signature` of a release, or `undefined` when there is no
 * key (the release then stays out of the Tauri feed). Refuses what the app
 * would reject: no signature when it embeds a `pubkey`, a key that is not
 * that `pubkey`'s, or a version Tauri cannot parse. Only a macOS `.app.tar.gz`
 * warns when unsigned: on Windows and Linux an installer is as likely an
 * Electron app's, which has no Tauri key.
 */
export const tauriSignature = (params: SignatureParams) =>
  Effect.gen(function* () {
    const { build } = params;
    const target = tauriTarget(build);
    if (target === undefined) {
      return undefined;
    }
    const keyText = yield* readTauriKeyText(params);
    if (keyText === undefined) {
      if (target.publicKey !== undefined) {
        return yield* new InvalidArgumentError({
          message: `The Tauri app only installs updates signed for its updater pubkey. Provide the private key (\`tauri signer generate\`) via --tauri-key-file, $${TAURI_PRIVATE_KEY_ENV}, or ${TAURI_PRIVATE_KEY_ENV} in the --environment's variables (password: $${TAURI_KEY_PASSWORD_ENV}).`,
        });
      }
      if (build.platform === "macos") {
        yield* printWarn(
          `No Tauri updater key: the release is not listed in the Tauri feed (set $${TAURI_PRIVATE_KEY_ENV} or pass --tauri-key-file).`,
        );
      }
      return undefined;
    }
    const version = build.appVersion;
    if (version === null || !SEMVER.test(version)) {
      return yield* new InvalidArgumentError({
        message: `The Tauri updater needs a semver version, but build ${build.id} has ${version === null ? "none" : `"${version}"`}.`,
      });
    }
    const key = yield* tauriKey(keyText, target.publicKey, params.setting);
    const signature = signTauriArchive(key, params.bytes, {
      fileName: target.fileName,
      version,
      timestamp: Math.floor(Date.now() / 1000),
    });
    const check = verifyTauriSignature(key, params.bytes, signature);
    if (!check.valid || check.signedVersion !== version) {
      return yield* new InvalidArgumentError({
        message: "The Tauri signature does not verify against its own key; the key is corrupt.",
      });
    }
    return signature;
  });
