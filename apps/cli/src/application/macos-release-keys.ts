/**
 * The update signatures `macos release create` computes locally — Sparkle's
 * EdDSA and the Tauri updater's minisign — and where it finds their keys: a
 * key-file flag, then the process environment, then the `--environment`'s
 * variables (pulled at most once). Keys never leave this machine; only the
 * signatures are uploaded.
 */
import { readMacosBuildMetadata } from "@better-update/api";
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

import type { ApiClient } from "../services/api-client";

export const SPARKLE_PRIVATE_KEY_ENV = "SPARKLE_PRIVATE_KEY";
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

/**
 * The archive's `sparkle:edSignature`, or `undefined` for an unsigned
 * release. Refuses a release the app would reject: one unsigned, or signed by
 * a key other than the app's `SUPublicEDKey`.
 */
export const sparkleSignature = (params: {
  readonly build: BuildWithArtifact;
  readonly bytes: Uint8Array;
  readonly keyFile: string | undefined;
  readonly setting: ReleaseSetting;
}) =>
  Effect.gen(function* () {
    const keyText =
      params.keyFile === undefined
        ? yield* params.setting(SPARKLE_PRIVATE_KEY_ENV)
        : yield* readKeyFile("--sparkle-key-file", params.keyFile);
    const appPublicKey = readMacosBuildMetadata(params.build.metadataJson)?.sparklePublicKey;
    if (keyText === undefined) {
      if (appPublicKey !== undefined) {
        return yield* new InvalidArgumentError({
          message: `The app verifies updates with SUPublicEDKey ${appPublicKey}, so an unsigned release would be rejected. Provide the Sparkle private key (\`generate_keys -x <file>\`) via --sparkle-key-file, $${SPARKLE_PRIVATE_KEY_ENV}, or ${SPARKLE_PRIVATE_KEY_ENV} in the --environment's variables.`,
        });
      }
      // A Tauri archive's app updates through Tauri, not Sparkle: nothing to warn about.
      if (params.build.artifact?.format !== "tar.gz") {
        yield* printWarn(
          `No Sparkle private key: the appcast item carries no EdDSA signature. That suits electron-updater feeds; a Sparkle 2 app accepts only signed updates (pass --sparkle-key-file or set $${SPARKLE_PRIVATE_KEY_ENV}).`,
        );
      }
      return undefined;
    }
    const key = parseSparklePrivateKey(keyText);
    if (typeof key === "string") {
      return yield* new InvalidArgumentError({ message: key });
    }
    const publicKey = sparklePublicKeyBase64(key);
    if (appPublicKey !== undefined && appPublicKey !== publicKey) {
      return yield* new InvalidArgumentError({
        message: `The Sparkle private key belongs to public key ${publicKey}, but the app verifies updates with SUPublicEDKey ${appPublicKey}; the app would reject this release.`,
      });
    }
    const signature = signSparkleArchive(key, params.bytes);
    if (!verifySparkleSignature(publicKey, signature, params.bytes)) {
      return yield* new InvalidArgumentError({
        message: "The Sparkle signature does not verify against its own key; the key is corrupt.",
      });
    }
    return signature;
  });

/** Tauri reads its key variable as the key itself or a path to it; so does the CLI. */
const keyOrPath = (value: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const isFile = yield* fs.exists(value.trim()).pipe(Effect.orElseSucceed(() => false));
    return isFile ? yield* readKeyFile(`$${TAURI_PRIVATE_KEY_ENV}`, value.trim()) : value;
  });

interface TauriSignatureParams {
  readonly build: BuildWithArtifact;
  readonly bytes: Uint8Array;
  readonly keyFile: string | undefined;
  readonly setting: ReleaseSetting;
}

const readTauriKeyText = (params: TauriSignatureParams) =>
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

/**
 * The Tauri updater `signature` of a `.app.tar.gz` release, or `undefined`
 * when there is no key (the release then stays out of the Tauri feed). Refuses
 * what the app would reject: no signature when it embeds a `pubkey`, a key
 * that is not that `pubkey`'s, or a version Tauri cannot parse.
 */
export const tauriSignature = (params: TauriSignatureParams) =>
  Effect.gen(function* () {
    const { build } = params;
    if (build.artifact?.format !== "tar.gz") {
      return undefined;
    }
    const metadata = readMacosBuildMetadata(build.metadataJson);
    const keyText = yield* readTauriKeyText(params);
    if (keyText === undefined) {
      if (metadata?.tauriPublicKey !== undefined) {
        return yield* new InvalidArgumentError({
          message: `The Tauri app only installs updates signed for its updater pubkey. Provide the private key (\`tauri signer generate\`) via --tauri-key-file, $${TAURI_PRIVATE_KEY_ENV}, or ${TAURI_PRIVATE_KEY_ENV} in the --environment's variables (password: $${TAURI_KEY_PASSWORD_ENV}).`,
        });
      }
      yield* printWarn(
        `No Tauri updater key: the release is not listed in the Tauri feed (set $${TAURI_PRIVATE_KEY_ENV} or pass --tauri-key-file).`,
      );
      return undefined;
    }
    const version = build.appVersion;
    if (version === null || !SEMVER.test(version)) {
      return yield* new InvalidArgumentError({
        message: `The Tauri updater needs a semver version, but build ${build.id} has ${version === null ? "none" : `"${version}"`}.`,
      });
    }
    const key = yield* tauriKey(keyText, metadata?.tauriPublicKey, params.setting);
    const signature = signTauriArchive(key, params.bytes, {
      fileName: `${metadata?.appName ?? "app"}.app.tar.gz`,
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
