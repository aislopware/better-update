/**
 * macOS notarization: submit an `.app`/`.dmg`/`.pkg`/`.zip` to Apple's notary
 * service with `xcrun notarytool`, wait for the verdict, surface the developer
 * log on rejection, then staple the ticket. Auth mirrors the iOS submit paths:
 * an ASC API key from the vault (primary — the `.p8` is staged in a private
 * temp dir for the duration of the calls) or an Apple ID + app-specific
 * password from {@link APPLE_APP_SPECIFIC_PASSWORD_ENV}.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { messageOf } from "../lib/apple-asc-connect";
import { fetchAscCredentials } from "../lib/asc-credentials";
import { execFailureDetail } from "../lib/exec-tool";
import { NotarizationError } from "../lib/exit-codes";
import {
  canStaple,
  classifyMacosArtifact,
  notaryFailureDetail,
  parseNotarySubmission,
  runDitto,
  runNotarytool,
  runStapler,
} from "../lib/macos-notary";
import { printHuman } from "../lib/output";
import { pickOrCreateAscApiKey } from "./asc-key-resolve";
import { APPLE_APP_SPECIFIC_PASSWORD_ENV } from "./submit-ios-altool";

import type { MacosArtifactKind } from "../lib/macos-notary";
import type { ApiClient } from "../services/api-client";

/**
 * How the submission authenticates to the notary service. The app-specific
 * password comes from {@link APPLE_APP_SPECIFIC_PASSWORD_ENV}; notarytool has
 * no `@env:` indirection (that is an altool feature), so it is passed via
 * argv — execFile means no shell interpolation, and the value never persists.
 */
export type MacosNotaryAuth =
  | { readonly kind: "asc-api-key"; readonly ascApiKeyId: string }
  | { readonly kind: "app-specific-password"; readonly appleId: string; readonly teamId: string };

/** Fully-resolved notary credentials, ready to become argv. */
export type StagedNotaryCredentials =
  | {
      readonly kind: "asc-api-key";
      /** Path of the staged `.p8`. */
      readonly p8Path: string;
      readonly keyId: string;
      readonly issuerId: string;
    }
  | {
      readonly kind: "app-specific-password";
      readonly appleId: string;
      readonly teamId: string;
      readonly password: string;
    };

/** Build the notarytool auth argv for staged credentials. Exported for tests. */
export const buildNotaryAuthArgs = (staged: StagedNotaryCredentials): readonly string[] =>
  staged.kind === "asc-api-key"
    ? ["--key", staged.p8Path, "--key-id", staged.keyId, "--issuer", staged.issuerId]
    : ["--apple-id", staged.appleId, "--team-id", staged.teamId, "--password", staged.password];

/**
 * Resolve the notary auth from command flags, mirroring the submit precedence
 * (ASC key over password): an explicit `--asc-key-id` wins; `--apple-id` opts
 * into the app-specific-password path (and then needs `--team-id`); otherwise
 * the shared team-labeled ASC-key picker (create-from-Apple-ID included) runs.
 */
export const resolveNotaryAuth = (
  api: ApiClient,
  flags: {
    readonly ascKeyId: string | undefined;
    readonly appleId: string | undefined;
    readonly teamId: string | undefined;
  },
) =>
  Effect.gen(function* () {
    if (flags.ascKeyId !== undefined && flags.ascKeyId.length > 0) {
      return { kind: "asc-api-key", ascApiKeyId: flags.ascKeyId } as const;
    }
    if (flags.appleId !== undefined && flags.appleId.length > 0) {
      if (flags.teamId === undefined || flags.teamId.length === 0) {
        return yield* new NotarizationError({
          message: "--apple-id auth also needs --team-id (the 10-character Apple team id).",
        });
      }
      return {
        kind: "app-specific-password",
        appleId: flags.appleId,
        teamId: flags.teamId,
      } as const;
    }
    const picked = yield* pickOrCreateAscApiKey(
      api,
      "Which ASC API key should authenticate the notarization?",
    ).pipe(
      Effect.mapError(
        (cause) =>
          new NotarizationError({
            message: `Could not resolve an App Store Connect API key: ${messageOf(cause)}`,
          }),
      ),
    );
    if (picked === null) {
      return yield* new NotarizationError({
        message:
          "No notary credentials. Pass --asc-key-id <id> (see `credentials list`), or --apple-id with the app-specific password in " +
          `$${APPLE_APP_SPECIFIC_PASSWORD_ENV} plus --team-id.`,
      });
    }
    return { kind: "asc-api-key", ascApiKeyId: picked } as const;
  });

export interface NotarizeMacosResult {
  readonly submissionId: string | null;
  readonly status: string;
  readonly stapled: boolean;
  readonly artifactPath: string;
}

export interface NotarizeMacosOptions {
  readonly artifactPath: string;
  readonly auth: MacosNotaryAuth;
  /** Wait for Apple's verdict (default). `false` returns after upload. */
  readonly wait: boolean;
  /** Staple the ticket after acceptance (default; skipped for `.zip`). */
  readonly staple: boolean;
}

const requireArtifactKind = (artifactPath: string) => {
  const kind = classifyMacosArtifact(artifactPath);
  return kind === null
    ? Effect.fail(
        new NotarizationError({
          message: `Unsupported artifact "${artifactPath}" — the notary service accepts .app (zipped automatically), .dmg, .pkg, or .zip.`,
        }),
      )
    : Effect.succeed(kind);
};

const stageAuth = (api: ApiClient, auth: MacosNotaryAuth, workDir: string) =>
  Effect.gen(function* () {
    if (auth.kind === "app-specific-password") {
      const password = process.env[APPLE_APP_SPECIFIC_PASSWORD_ENV];
      if (password === undefined || password === "") {
        return yield* new NotarizationError({
          message: `--apple-id auth needs the app-specific password in $${APPLE_APP_SPECIFIC_PASSWORD_ENV}.`,
        });
      }
      return buildNotaryAuthArgs({
        kind: "app-specific-password",
        appleId: auth.appleId,
        teamId: auth.teamId,
        password,
      });
    }
    const credentials = yield* fetchAscCredentials(api, auth.ascApiKeyId);
    const p8Path = path.join(workDir, `AuthKey_${credentials.keyId}.p8`);
    yield* Effect.promise(async () => writeFile(p8Path, credentials.p8Pem, "utf8"));
    return buildNotaryAuthArgs({
      kind: "asc-api-key",
      p8Path,
      keyId: credentials.keyId,
      issuerId: credentials.issuerId,
    });
  });

/** Zip an `.app` bundle for submission; other kinds upload as-is. */
const stageSubmitPath = (artifactPath: string, kind: MacosArtifactKind, workDir: string) =>
  Effect.gen(function* () {
    if (kind !== "app") {
      return artifactPath;
    }
    const zipPath = path.join(workDir, `${path.basename(artifactPath)}.zip`);
    yield* printHuman(`Zipping ${path.basename(artifactPath)} for submission...`);
    const result = yield* runDitto(["-c", "-k", "--keepParent", artifactPath, zipPath]);
    if (result.exitCode !== 0) {
      return yield* new NotarizationError({
        message: `ditto failed to zip the app bundle: ${execFailureDetail(result)}`,
      });
    }
    return zipPath;
  });

const printDeveloperLog = (submissionId: string, authArgs: readonly string[]) =>
  Effect.gen(function* () {
    const log = yield* runNotarytool(["log", submissionId, ...authArgs]);
    if (log.exitCode === 0 && log.stdout.trim().length > 0) {
      yield* printHuman("");
      yield* printHuman("Notary developer log:");
      yield* printHuman(log.stdout.trim());
    }
  });

const stapleArtifact = (targetPath: string) =>
  Effect.gen(function* () {
    yield* printHuman(`Stapling the notarization ticket to ${path.basename(targetPath)}...`);
    const staple = yield* runStapler(["staple", targetPath]);
    if (staple.exitCode !== 0) {
      return yield* new NotarizationError({
        message: `stapler staple failed: ${execFailureDetail(staple)}`,
      });
    }
    const validate = yield* runStapler(["validate", targetPath]);
    if (validate.exitCode !== 0) {
      return yield* new NotarizationError({
        message: `Ticket stapled but validation failed: ${execFailureDetail(validate)}`,
      });
    }
    return undefined;
  });

/**
 * Full notarization pass. Everything secret-adjacent (staged `.p8`, the
 * temporary submission zip) lives in one private temp dir removed on every
 * termination path via acquireUseRelease.
 */
export const notarizeMacosArtifact = (api: ApiClient, options: NotarizeMacosOptions) =>
  Effect.gen(function* () {
    const kind = yield* requireArtifactKind(options.artifactPath);
    return yield* Effect.acquireUseRelease(
      Effect.promise(async () => mkdtemp(path.join(tmpdir(), "better-update-notary-"))),
      (workDir) => runNotarization(api, options, kind, workDir),
      (workDir) => Effect.promise(async () => rm(workDir, { recursive: true, force: true })),
    );
  });

const runNotarization = (
  api: ApiClient,
  options: NotarizeMacosOptions,
  kind: MacosArtifactKind,
  workDir: string,
) =>
  Effect.gen(function* () {
    const authArgs = yield* stageAuth(api, options.auth, workDir);
    const submitPath = yield* stageSubmitPath(options.artifactPath, kind, workDir);

    yield* printHuman(
      options.wait
        ? "Submitting to the Apple notary service and waiting for the verdict (typically a few minutes)..."
        : "Submitting to the Apple notary service...",
    );
    const submit = yield* runNotarytool([
      "submit",
      submitPath,
      ...authArgs,
      "--output-format",
      "json",
      ...(options.wait ? ["--wait"] : []),
    ]);
    const parsed = parseNotarySubmission(submit.stdout);
    const submissionId = parsed.id === undefined ? null : parsed.id;

    if (submit.exitCode !== 0) {
      if (submissionId !== null) {
        yield* printDeveloperLog(submissionId, authArgs);
      }
      return yield* new NotarizationError({
        message: `notarytool submit failed${submissionId === null ? "" : ` (submission ${submissionId})`}: ${notaryFailureDetail(submit)}`,
      });
    }

    if (!options.wait) {
      yield* printHuman(
        `Uploaded. Submission id: ${submissionId ?? "unknown"} — check later with \`xcrun notarytool info ${submissionId ?? "<id>"}\` or re-run with --wait.`,
      );
      return {
        submissionId,
        status: "In Progress",
        stapled: false,
        artifactPath: options.artifactPath,
      } satisfies NotarizeMacosResult;
    }

    const status = parsed.status ?? "unknown";
    if (status !== "Accepted") {
      if (submissionId !== null) {
        yield* printDeveloperLog(submissionId, authArgs);
      }
      return yield* new NotarizationError({
        message: `Notarization ${status.toLowerCase()}${submissionId === null ? "" : ` (submission ${submissionId})`}: ${parsed.message ?? "see the developer log above"}.`,
      });
    }
    yield* printHuman("Notarization accepted.");

    const shouldStaple = options.staple && canStaple(kind);
    if (options.staple && !canStaple(kind)) {
      yield* printHuman(
        "Skipping staple: a .zip cannot carry the ticket — staple the .app inside it instead (`xcrun stapler staple <app>`).",
      );
    }
    if (shouldStaple) {
      yield* stapleArtifact(options.artifactPath);
    }
    return {
      submissionId,
      status,
      stapled: shouldStaple,
      artifactPath: options.artifactPath,
    } satisfies NotarizeMacosResult;
  });
