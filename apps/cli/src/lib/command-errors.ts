import { Context, Effect, Layer, PlatformError } from "effect";

import { exitWith } from "../application/command-exit";
import { formatCause } from "./format-error";

import type { CliRuntime } from "../services/cli-runtime";
import type { OutputMode } from "./output-mode";

export type ExitCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ExitCodeMap = Readonly<Record<string, ExitCode>>;

/**
 * `_tag → exit code` for every failure a command can surface. Documented in
 * `skills/better-update/references/cli.md#exit-codes`; a tag missing here
 * exits 1 with the squashed cause as the message.
 */
export const BASE_EXIT_CODES: ExitCodeMap = {
  // 1 — general failure / not found
  AppStoreError: 1,
  Conflict: 1,
  EnvResourceNotFoundError: 1,
  FingerprintMismatchError: 1,
  Forbidden: 1,
  NotFound: 1,
  OrgError: 1,
  // 2 — validation
  BadRequest: 2,
  BuildProfileError: 2,
  ChannelCommandError: 2,
  CredentialValidationError: 2,
  FingerprintError: 2,
  IdentityError: 2,
  InteractiveProhibitedError: 2,
  InvalidArgumentError: 2,
  RuntimeVersionError: 2,
  UpdateCommandError: 2,
  UpdatePromoteError: 2,
  UpdateRollbackError: 2,
  // 3 — auth
  AuthRequiredError: 3,
  DirtyRepoError: 3,
  LoginError: 3,
  // 4 — project not linked / Apple auth
  AppleAuthError: 4,
  ProjectNotLinkedError: 4,
  // 5 — missing credentials
  CredentialsJsonError: 5,
  MissingCredentialsError: 5,
  // 6 — tooling / build / filesystem
  ApnsKeyLimitError: 6,
  AppleConnectError: 6,
  AppleIdGenerateFailedError: 6,
  ArtifactNotFoundError: 6,
  BuildFailedError: 6,
  CertificateLimitError: 6,
  CodesignError: 6,
  KeychainError: 6,
  NativeRunError: 6,
  NotarizationError: 6,
  // effect's FileSystem / ChildProcess failure (reason: SystemError | BadArgument)
  PlatformError: 6,
  ProvisioningError: 6,
  StagingError: 6,
  // 7 — publish / upload pipeline
  BaseDownloadError: 7,
  BsdiffError: 7,
  CompleteError: 7,
  EnvExportError: 7,
  PatchUploadError: 7,
  PresignedUrlExpiredError: 7,
  ReserveError: 7,
  UpdatePublishError: 7,
  UploadFailedError: 7,
};

/**
 * The active `_tag → exit code` policy. Defaults to {@link BASE_EXIT_CODES};
 * a command subtree that documents different codes (the Apple-portal commands
 * exit 4 on interactive-prohibited, `credentials sync` exits 5 on validation)
 * overrides it with {@link exitCodeOverrides} via `Command.provide`.
 */
export const ExitCodePolicy = Context.Reference<ExitCodeMap>("cli/ExitCodePolicy", {
  defaultValue: () => BASE_EXIT_CODES,
});

export const exitCodeOverrides = (overrides: ExitCodeMap): Layer.Layer<never> =>
  Layer.succeed(ExitCodePolicy, { ...BASE_EXIT_CODES, ...overrides });

/** Apple Developer portal commands: auth + interactive-prohibited both exit 4 (documented). */
export const applePortalExitCodes = exitCodeOverrides({ InteractiveProhibitedError: 4 });

/** `PlatformError` wraps either a rejected argument or an OS-level failure; say which. */
const describePlatformError = (error: TaggedFailure): string =>
  error instanceof PlatformError.PlatformError && error.reason._tag === "BadArgument"
    ? `Invalid argument: ${error.message}`
    : `Filesystem error: ${error.message}`;

const TAG_MESSAGE: Readonly<Record<string, (error: TaggedFailure) => string>> = {
  PlatformError: describePlatformError,
};

interface TaggedFailure {
  readonly _tag: string;
  readonly message: string;
  readonly hint?: unknown;
}

const isTaggedFailure = (error: unknown): error is TaggedFailure =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string" &&
  "message" in error &&
  typeof error.message === "string";

/**
 * Map every failure to its exit code + error envelope so the resulting
 * effect's failure channel is `never`. Tags outside the policy exit 1 with the
 * squashed cause; interruption (Ctrl-C at a prompt) is not a failure and passes
 * through to the runtime, which exits 130.
 */
export const handleCommandErrors = <Requirements>(
  effect: Effect.Effect<unknown, unknown, Requirements>,
): Effect.Effect<void, never, Requirements | CliRuntime | OutputMode> =>
  Effect.gen(function* () {
    const policy = yield* ExitCodePolicy;
    return yield* effect.pipe(
      Effect.asVoid,
      Effect.catch((error) => {
        if (!isTaggedFailure(error)) {
          return exitWith(1, { tag: "Unknown", message: formatCause(error) });
        }
        const code = policy[error._tag];
        if (code === undefined) {
          return exitWith(1, { tag: "Unknown", message: formatCause(error) });
        }
        const format = TAG_MESSAGE[error._tag];
        return exitWith(code, {
          tag: error._tag,
          message: format ? format(error) : error.message,
          hint: typeof error.hint === "string" ? error.hint : undefined,
        });
      }),
    );
  });
