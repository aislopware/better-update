/**
 * The legacy `xcrun altool` iOS upload path: auth shapes shared by both
 * uploaders, plus the altool invocation itself (ASC key staged under
 * `$API_PRIVATE_KEYS_DIR`, or Apple ID + app-specific password via `@env:`).
 * Kept fully functional — it is the app-specific-password path and the
 * automatic fallback when the Build Upload API is unavailable.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { altoolFailureDetail, isDuplicateBuildUpload, runAltool } from "../lib/altool";
import { printHuman } from "../lib/output";
import { CliSubmitError } from "./submit-flow";

import type { AscCredentials } from "../lib/asc-credentials";

/** EAS-compatible env var carrying the Apple ID app-specific password. */
export const APPLE_APP_SPECIFIC_PASSWORD_ENV = "EXPO_APPLE_APP_SPECIFIC_PASSWORD";

/**
 * How the `.ipa` is authenticated to App Store Connect, mirroring `eas submit`'s
 * two mutually-exclusive paths: an ASC API key (`.p8`) or an Apple ID + an
 * app-specific password supplied via {@link APPLE_APP_SPECIFIC_PASSWORD_ENV}.
 */
export type IosUploadAuth =
  | { readonly kind: "asc-api-key"; readonly ascApiKeyId: string }
  | { readonly kind: "app-specific-password"; readonly appleId: string };

export const hasAppleAppSpecificPassword = (): boolean => {
  const value = process.env[APPLE_APP_SPECIFIC_PASSWORD_ENV];
  return value !== undefined && value !== "";
};

/**
 * `altool --apiKey <id>` searches for a file named *exactly* `AuthKey_<id>.p8` in
 * the standard `private_keys` dirs plus `$API_PRIVATE_KEYS_DIR`. Write the decrypted
 * `.p8` under that exact name into a fresh private temp dir and return the dir so the
 * caller can point `API_PRIVATE_KEYS_DIR` at it (and remove it afterward — it holds
 * the unencrypted signing key).
 */
const writeP8KeyDir = (credentials: AscCredentials) =>
  Effect.promise(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "better-update-asc-"));
    await writeFile(path.join(dir, `AuthKey_${credentials.keyId}.p8`), credentials.p8Pem, "utf8");
    return dir;
  });

const removeKeyDir = (dir: string) =>
  Effect.promise(async () => {
    await rm(dir, { recursive: true, force: true });
  });

const baseAltoolArgs = (ipaPath: string): readonly string[] => [
  "--upload-app",
  "--type",
  "ios",
  "--file",
  ipaPath,
  "--output-format",
  "xml",
];

/** Build `altool` args for the chosen auth. The app-specific password is passed
 * as `@env:` so it never enters argv; `altool` reads it from the inherited env. */
const buildAltoolArgs = (params: {
  readonly auth: IosUploadAuth;
  readonly ascCredentials: AscCredentials | null;
  readonly ipaPath: string;
}) =>
  Effect.gen(function* () {
    if (params.auth.kind === "app-specific-password") {
      return [
        ...baseAltoolArgs(params.ipaPath),
        "--username",
        params.auth.appleId,
        "--password",
        `@env:${APPLE_APP_SPECIFIC_PASSWORD_ENV}`,
      ];
    }
    if (params.ascCredentials === null) {
      return yield* new CliSubmitError({
        code: "SUBMISSION_ASC_KEY_FETCH_FAILED",
        message: "ASC API key is required for an asc-api-key upload but was not resolved.",
      });
    }
    // The `.p8` is located by name via `$API_PRIVATE_KEYS_DIR`, set when running altool.
    return [
      ...baseAltoolArgs(params.ipaPath),
      "--apiKey",
      params.ascCredentials.keyId,
      "--apiIssuer",
      params.ascCredentials.issuerId,
    ];
  });

/**
 * Run `altool` to upload the `.ipa`. For an ASC API key, altool finds the `.p8` by
 * name via `$API_PRIVATE_KEYS_DIR`; stage it in a temp dir scoped to the upload and
 * remove it after. A duplicate-build rejection is benign (already there) — return.
 */
export const uploadIpaViaAltool = (params: {
  readonly auth: IosUploadAuth;
  readonly ascCredentials: AscCredentials | null;
  readonly ipaPath: string;
}) =>
  Effect.gen(function* () {
    const altoolArgs = yield* buildAltoolArgs(params);
    const result =
      params.auth.kind === "asc-api-key" && params.ascCredentials !== null
        ? yield* Effect.acquireUseRelease(
            writeP8KeyDir(params.ascCredentials),
            (keyDir) => runAltool(altoolArgs, { API_PRIVATE_KEYS_DIR: keyDir }),
            (keyDir) => removeKeyDir(keyDir),
          )
        : yield* runAltool(altoolArgs);
    if (result.exitCode === 0) {
      yield* printHuman("altool upload complete.");
      return;
    }
    const detail = altoolFailureDetail(result);
    if (isDuplicateBuildUpload(detail)) {
      yield* printHuman(
        `Build already on App Store Connect (${detail}) — continuing to TestFlight configuration.`,
      );
      return;
    }
    return yield* new CliSubmitError({
      code: "SUBMISSION_SERVICE_IOS_ALTOOL_FAILED",
      message: `xcrun altool exited ${String(result.exitCode)}: ${detail}`,
    });
  });
