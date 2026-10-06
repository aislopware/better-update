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
  formatNotaryIssues,
  isNotaryTimeout,
  notaryFailureDetail,
  parseNotaryLog,
  parseNotaryResult,
  runDitto,
  runNotarytool,
  runStapler,
} from "../lib/macos-notary";
import { printHuman } from "../lib/output";
import { pickOrCreateAscApiKey } from "./asc-key-resolve";
import { APPLE_APP_SPECIFIC_PASSWORD_ENV } from "./submit-ios-altool";

import type { MacosArtifactKind, NotaryIssue } from "../lib/macos-notary";
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
      /** `null` for an individual key — `notarytool` then takes no `--issuer`. */
      readonly issuerId: string | null;
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
    ? [
        "--key",
        staged.p8Path,
        "--key-id",
        staged.keyId,
        ...(staged.issuerId === null ? [] : ["--issuer", staged.issuerId]),
      ]
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
  readonly submissionId: string;
  /** Apple's verdict (`Accepted`), or `In Progress` when not waited for / timed out. */
  readonly status: string;
  readonly stapled: boolean;
  /** True when `--timeout` elapsed first; the submission keeps processing at Apple. */
  readonly timedOut: boolean;
  readonly artifactPath: string;
}

export interface NotarizeMacosOptions {
  readonly artifactPath: string;
  readonly auth: MacosNotaryAuth;
  /** Wait for Apple's verdict (default). `false` returns after upload. */
  readonly wait: boolean;
  /** Staple the ticket after acceptance (default; skipped for `.zip`). */
  readonly staple: boolean;
  /**
   * Bound on the wait, in notarytool's `<n>[s|m|h]` form. When it elapses the
   * result is `In Progress` + `timedOut`, never a failure: Apple keeps
   * processing, and the submission id resumes it.
   */
  readonly timeout?: string | undefined;
  /** Resume an earlier submission instead of uploading again. */
  readonly submissionId?: string | undefined;
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

/**
 * Fetch the developer log of a rejected submission and turn it into one line
 * per problem. Falls back to the raw log when it does not parse.
 */
const describeRejection = (submissionId: string, authArgs: readonly string[]) =>
  Effect.gen(function* () {
    const log = yield* runNotarytool(["log", submissionId, ...authArgs]);
    const issues: readonly NotaryIssue[] = log.exitCode === 0 ? parseNotaryLog(log.stdout) : [];
    if (issues.length > 0) {
      return formatNotaryIssues(issues);
    }
    const raw = log.stdout.trim();
    return raw.length > 0 ? raw : "the developer log was unavailable";
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

const submitArtifact = (
  options: NotarizeMacosOptions,
  kind: MacosArtifactKind,
  workDir: string,
  authArgs: readonly string[],
) =>
  Effect.gen(function* () {
    const submitPath = yield* stageSubmitPath(options.artifactPath, kind, workDir);
    yield* printHuman("Uploading to the Apple notary service...");
    // No `--wait` here: the id comes back as soon as the upload finishes, so an
    // interrupted or timed-out wait can always be resumed.
    const submit = yield* runNotarytool([
      "submit",
      submitPath,
      ...authArgs,
      "--output-format",
      "json",
    ]);
    const { id } = parseNotaryResult(submit);
    if (submit.exitCode !== 0 || id === undefined) {
      return yield* new NotarizationError({
        message: `notarytool submit failed: ${notaryFailureDetail(submit)}`,
      });
    }
    return id;
  });

const runNotarization = (
  api: ApiClient,
  options: NotarizeMacosOptions,
  kind: MacosArtifactKind,
  workDir: string,
) =>
  Effect.gen(function* () {
    const authArgs = yield* stageAuth(api, options.auth, workDir);
    const submissionId =
      options.submissionId ?? (yield* submitArtifact(options, kind, workDir, authArgs));
    const resumeHint = `better-update macos notarize "${options.artifactPath}" --submission-id ${submissionId}`;
    yield* printHuman(`Submission ${submissionId} (resume any time: ${resumeHint})`);
    const inProgress = (timedOut: boolean): NotarizeMacosResult => ({
      submissionId,
      status: "In Progress",
      stapled: false,
      timedOut,
      artifactPath: options.artifactPath,
    });
    if (!options.wait) {
      return inProgress(false);
    }

    yield* printHuman(
      "Waiting for Apple's verdict (usually minutes; a new certificate's first submissions can take hours)...",
    );
    const waited = yield* runNotarytool([
      "wait",
      submissionId,
      ...authArgs,
      "--output-format",
      "json",
      ...(options.timeout === undefined ? [] : ["--timeout", options.timeout]),
    ]);
    if (isNotaryTimeout(waited)) {
      yield* printHuman(`Still processing at Apple. Resume with: ${resumeHint}`);
      return inProgress(true);
    }
    const { status } = parseNotaryResult(waited);
    if (status === undefined) {
      return yield* new NotarizationError({
        message: `notarytool wait failed (submission ${submissionId}): ${notaryFailureDetail(waited)}`,
      });
    }
    if (status !== "Accepted") {
      const detail = yield* describeRejection(submissionId, authArgs);
      return yield* new NotarizationError({
        message: `Notarization ${status.toLowerCase()} (submission ${submissionId}):\n${detail}`,
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
      timedOut: false,
      artifactPath: options.artifactPath,
    } satisfies NotarizeMacosResult;
  });
