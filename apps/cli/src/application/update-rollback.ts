import { randomUUID } from "node:crypto";
import path from "node:path";

import { buildRollbackDirectiveBody } from "@better-update/expo-protocol";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { readRuntimeVersionMeta } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { UpdateRollbackError } from "../lib/exit-codes";
import {
  extractCodeSigningConfig,
  extractProjectId,
  extractSlug,
  readExpoConfig,
} from "../lib/expo-config";
import { formatCause } from "../lib/format-error";
import { signDirectiveBody } from "../lib/manifest-signing";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { resolveUpdatePlatforms } from "../lib/update-platforms";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { Platform } from "../lib/build-profile";
import type {
  AuthRequiredError,
  BuildProfileError,
  EnvExportError,
  ProjectNotLinkedError,
  RuntimeVersionError,
} from "../lib/exit-codes";
import type { ExpoConfig } from "../lib/expo-config";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { UpdatePlatformOption } from "../lib/update-platforms";
import type { ApiClientService } from "../services/api-client";
import type { IdentityStore } from "../services/identity-store";

interface CreateRollbackParams {
  readonly branch: string;
  readonly projectSlug: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  readonly message: string;
  readonly groupId: string;
  readonly directiveBody: string;
  readonly signature: string | undefined;
  readonly certificateChain: string | undefined;
}

export interface RollbackResultItem {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
}

export interface RunUpdateRollbackOptions {
  readonly branch: string;
  readonly platform: UpdatePlatformOption;
  readonly environment: string;
  readonly message: string | undefined;
  readonly commitTime: string | undefined;
  readonly directiveBodyFile: string | undefined;
  readonly signatureFile: string | undefined;
  readonly certificateChainFile: string | undefined;
  // Auto-sign path: RSA private key (PEM) that signs the rendered rollback
  // directive, reading the certificate from `updates.codeSigningCertificate` in
  // app.json (parity with `update publish --private-key-path`). Mutually
  // exclusive with the --*-file escape hatch above.
  readonly privateKeyPath: string | undefined;
}

export interface UpdateRollbackResult {
  readonly groupId: string;
  readonly branch: string;
  readonly commitTime: string;
  readonly results: readonly RollbackResultItem[];
}

interface SignedRollbackPayload {
  readonly directiveBody: string;
  readonly signature: string;
  readonly certificateChain: string;
}

// Both native expo-updates clients parse the directive `commitTime` with a
// STRICT fixed-format parser: Android `parseDateString` only accepts
// `yyyy-MM-dd'T'HH:mm:ss.SSS'X'` / `...'Z'` (mandatory 3 ms digits + a literal
// timezone) and THROWS otherwise, which propagates out of `UpdateDirective`
// parsing and aborts the whole update load; iOS uses `yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ`.
// `Date.parse` is far more permissive (accepts no-ms, date-only, RFC-2822,
// numeric offsets), so a value that the CLI accepts can brick the rollback
// on-device. Canonicalize the GENERATED directive's commitTime to the strict
// `YYYY-MM-DDTHH:mm:ss.SSSZ` form before it is rendered + (optionally) signed.
const resolveCommitTime = (input: string | undefined): Effect.Effect<string, UpdateRollbackError> =>
  Effect.gen(function* () {
    const raw = input ?? new Date().toISOString();
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      return yield* new UpdateRollbackError({
        message: "commitTime must be a valid ISO 8601 timestamp.",
      });
    }
    // Re-stamp through the canonical ISO form (always ms + trailing Z, UTC) so
    // the served directive carries a commitTime both native clients can parse.
    return new Date(parsed).toISOString();
  });

const extractDirectiveCommitTime = (
  directiveBody: string,
): Effect.Effect<string, UpdateRollbackError> =>
  Effect.gen(function* () {
    const directive = yield* Effect.try({
      try: (): unknown => JSON.parse(directiveBody),
      catch: () =>
        new UpdateRollbackError({
          message: "directiveBody must be valid JSON.",
        }),
    });

    if (!isRecord(directive)) {
      return yield* new UpdateRollbackError({
        message: "directiveBody must decode to a JSON object.",
      });
    }

    if (directive["type"] !== "rollBackToEmbedded") {
      return yield* new UpdateRollbackError({
        message: 'directiveBody.type must be "rollBackToEmbedded".',
      });
    }

    const { parameters } = directive;
    if (!isRecord(parameters)) {
      return yield* new UpdateRollbackError({
        message: "directiveBody.parameters must be an object.",
      });
    }

    const { commitTime } = parameters;
    if (typeof commitTime !== "string" || Number.isNaN(Date.parse(commitTime))) {
      return yield* new UpdateRollbackError({
        message: "directiveBody.parameters.commitTime must be a valid ISO 8601 timestamp.",
      });
    }

    // The signed directive bytes are served verbatim (re-stamping would break
    // the supplied signature), so we cannot canonicalize them here — we can only
    // REJECT a non-canonical value. Both native clients only parse the strict
    // `YYYY-MM-DDTHH:mm:ss.SSSZ` form (3 ms digits + literal Z; numeric offsets
    // are rejected even with full ms), so require the commitTime to round-trip
    // through that exact form. The publisher must sign canonical-format bytes.
    if (new Date(Date.parse(commitTime)).toISOString() !== commitTime) {
      return yield* new UpdateRollbackError({
        message:
          "directiveBody.parameters.commitTime must be canonical ISO 8601 with milliseconds and a trailing Z (e.g. 2026-05-06T14:00:00.000Z). The expo-updates client cannot parse other forms (no milliseconds, numeric timezone offsets), so the signed rollback would be rejected on-device.",
      });
    }

    return commitTime;
  });

const loadOptionalSignedRollbackPayload = (
  options: RunUpdateRollbackOptions,
): Effect.Effect<SignedRollbackPayload | null, UpdateRollbackError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const hasAnySigningInput =
      options.directiveBodyFile !== undefined ||
      options.signatureFile !== undefined ||
      options.certificateChainFile !== undefined;

    if (!hasAnySigningInput) {
      return null;
    }

    if (!options.directiveBodyFile || !options.signatureFile || !options.certificateChainFile) {
      return yield* new UpdateRollbackError({
        message:
          "Signed rollback requires --directive-body-file, --signature-file, and --certificate-chain-file together.",
      });
    }

    const [directiveBody, signature, certificateChain] = yield* Effect.all(
      [
        fileSystem.readFileString(options.directiveBodyFile),
        fileSystem.readFileString(options.signatureFile),
        fileSystem.readFileString(options.certificateChainFile),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdateRollbackError({
            message: `Failed to read signed rollback inputs: ${formatCause(cause)}`,
          }),
      ),
    );

    return {
      directiveBody,
      signature: signature.trim(),
      certificateChain: certificateChain.trimEnd(),
    } satisfies SignedRollbackPayload;
  });

// Auto-sign path (parity with `update publish --private-key-path`): read the
// code-signing config from app.json, load the RSA private key + certificate
// chain, then render + code-sign the rollback directive in-process. The directive
// body is platform-independent (it only carries `commitTime`), so a single signed
// triple is shared by every rolled-back platform — exactly like the file payload.
//
// Signs the bare directive body only; no `extra.signingInfo` project-binding is
// injected, which is correct for the DEVELOPMENT / self-signed certs self-hosted
// projects generate (no `expoProjectInformation` extension → the device skips the
// project-info cross-check). Matches the manifest signer's scope.
const buildAutoSignedRollback = (params: {
  readonly privateKeyPath: string;
  readonly expoConfig: ExpoConfig;
  readonly projectRoot: string;
  readonly commitTime: string;
}): Effect.Effect<SignedRollbackPayload, UpdateRollbackError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const codeSigning = yield* extractCodeSigningConfig(params.expoConfig).pipe(
      Effect.mapError((cause) => new UpdateRollbackError({ message: cause.message })),
    );
    if (codeSigning === undefined) {
      return yield* new UpdateRollbackError({
        message:
          "--private-key-path was provided but updates.codeSigningCertificate is not set in your Expo config. Add the certificate path to app.json.",
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const certificateAbsolutePath = path.resolve(params.projectRoot, codeSigning.certificatePath);
    const [privateKeyPem, certificateChainPem] = yield* Effect.all(
      [
        fileSystem.readFileString(params.privateKeyPath),
        fileSystem.readFileString(certificateAbsolutePath),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdateRollbackError({
            message: `Failed to read code-signing key/certificate: ${formatCause(cause)}`,
          }),
      ),
    );

    const directiveBody = buildRollbackDirectiveBody(params.commitTime);
    const { signature } = yield* signDirectiveBody({
      bodyBytes: directiveBody,
      privateKeyPem,
      certificatePem: certificateChainPem,
      keyid: codeSigning.keyid,
    });

    return {
      directiveBody,
      signature,
      certificateChain: certificateChainPem,
    } satisfies SignedRollbackPayload;
  });

const createRollbackForPlatform = (
  params: CreateRollbackParams,
): Effect.Effect<RollbackResultItem, AuthRequiredError | UpdateRollbackError, ApiClientService> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const update = yield* api.updates
      .create({
        payload: {
          branch: params.branch,
          slug: params.projectSlug,
          runtimeVersion: params.runtimeVersion,
          platform: params.platform,
          message: params.message,
          groupId: params.groupId,
          metadata: {},
          assets: [],
          isRollback: true,
          directiveBody: params.directiveBody,
          ...(params.signature ? { signature: params.signature } : {}),
          ...(params.certificateChain ? { certificateChain: params.certificateChain } : {}),
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdateRollbackError({
              message: `Failed to create ${params.platform} rollback: ${formatCause(cause)}`,
            }),
        ),
      );

    return {
      platform: params.platform,
      updateId: update.id,
      runtimeVersion: params.runtimeVersion,
    } as const satisfies RollbackResultItem;
  });

export const runUpdateRollback = (
  options: RunUpdateRollbackOptions,
): Effect.Effect<
  UpdateRollbackResult,
  | AuthRequiredError
  | ProjectNotLinkedError
  | BuildProfileError
  | EnvExportError
  | RuntimeVersionError
  | UpdateRollbackError,
  | ApiClientService
  | CliRuntime
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | IdentityStore
  | InteractiveMode
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const api = yield* apiClient;

    const baseConfig = yield* readExpoConfig(projectRoot);
    const projectId = yield* extractProjectId(baseConfig);

    const environmentVars = yield* pullEnvVars(api, {
      projectId,
      environment: options.environment,
    });

    // Re-resolve with the env-var overlay so runtimeVersion / ios / android
    // sections (and slug) derived from process.env match what the corresponding
    // publish would have computed — otherwise rollback can target the wrong
    // runtime or publish under a stale slug.
    const config = yield* readExpoConfig(projectRoot, environmentVars);
    const projectSlug = yield* extractSlug(config);
    const platforms = resolveUpdatePlatforms(config, options.platform);
    if (platforms.length === 0) {
      return yield* new UpdateRollbackError({
        message:
          'No publishable platforms found in your Expo config. Add an "ios" or "android" section, or pass --platform explicitly.',
      });
    }

    const fileSignedPayload = yield* loadOptionalSignedRollbackPayload(options);
    // --private-key-path (auto-sign) and the --*-file escape hatch both produce a
    // signed triple; accepting both at once is ambiguous, so reject it up front.
    if (options.privateKeyPath !== undefined && fileSignedPayload !== null) {
      return yield* new UpdateRollbackError({
        message:
          "--private-key-path cannot be combined with the --directive-body-file/--signature-file/--certificate-chain-file options. Use one signing path or the other.",
      });
    }
    const commitTime = fileSignedPayload
      ? yield* Effect.gen(function* () {
          const directiveCommitTime = yield* extractDirectiveCommitTime(
            fileSignedPayload.directiveBody,
          );
          if (options.commitTime && options.commitTime !== directiveCommitTime) {
            return yield* new UpdateRollbackError({
              message: "commitTime must match directiveBody.parameters.commitTime in signed mode.",
            });
          }
          return directiveCommitTime;
        })
      : yield* resolveCommitTime(options.commitTime);
    // Effective signed payload: the file escape-hatch, else the in-process
    // auto-sign (rendered + signed once over the platform-independent directive),
    // else null (unsigned). The per-platform create below falls back to a fresh
    // unsigned directive body when this is null.
    const signedPayload =
      fileSignedPayload ??
      (options.privateKeyPath === undefined
        ? null
        : yield* buildAutoSignedRollback({
            privateKeyPath: options.privateKeyPath,
            expoConfig: config,
            projectRoot,
            commitTime,
          }));
    const groupId = randomUUID();
    const message = options.message ?? "Rollback to embedded via better-update CLI";

    const results = yield* Effect.forEach(
      platforms,
      (platform) =>
        Effect.gen(function* () {
          // Resolve the runtimeVersion PER platform: the `nativeVersion` policy
          // yields `version(buildNumber)` where buildNumber is ios.buildNumber
          // for iOS and android.versionCode for Android, so the value differs by
          // platform and must be recomputed for each rollback target.
          const meta = readRuntimeVersionMeta(config, platform);
          const runtimeVersion = yield* resolveRuntimeVersion({
            raw: meta.rawRuntimeVersion,
            appVersion: meta.appVersion,
            projectRoot,
            platform,
            buildNumber: meta.buildNumber,
            sdkVersion: meta.sdkVersion,
          });
          return yield* createRollbackForPlatform({
            branch: options.branch,
            projectSlug,
            runtimeVersion,
            platform,
            message,
            groupId,
            directiveBody: signedPayload?.directiveBody ?? buildRollbackDirectiveBody(commitTime),
            signature: signedPayload?.signature,
            certificateChain: signedPayload?.certificateChain,
          });
        }),
      { concurrency: 1 },
    );

    return {
      groupId,
      branch: options.branch,
      commitTime,
      results,
    } as const satisfies UpdateRollbackResult;
  });
