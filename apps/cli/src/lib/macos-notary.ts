/**
 * Thin wrappers around the macOS notarization toolchain: `xcrun notarytool`
 * (submit/log/info), `xcrun stapler` (staple/validate), and `ditto` (zip an
 * `.app` for submission). Follows the altool.ts contract — tools never fail
 * the Effect; failures come back as an {@link ExecResult} with a non-zero exit
 * and the real reason is parsed out of notarytool's `--output-format json`
 * stdout.
 */
import { toOptional } from "@better-update/type-guards";
import { Schema } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";

import type { ExecResult } from "./altool";

export const runNotarytool = (args: readonly string[], extraEnv?: Record<string, string>) =>
  runTool("xcrun", ["notarytool", ...args], extraEnv);

export const runStapler = (args: readonly string[]) => runTool("xcrun", ["stapler", ...args]);

export const runDitto = (args: readonly string[]) => runTool("ditto", args);

// ── submission result parsing ─────────────────────────────────────

/**
 * The JSON `notarytool submit --output-format json` prints: always an `id` and
 * `message`; `status` only when `--wait` ran to completion ("Accepted",
 * "Invalid", "Rejected").
 */
export interface NotarySubmission {
  readonly id: string | undefined;
  readonly status: string | undefined;
  readonly message: string | undefined;
}

const NotarySubmissionSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

/**
 * Parse notarytool's JSON stdout. Tolerates non-JSON noise before the payload
 * (some Xcode versions print an informational line first) by parsing from the
 * first `{`. Returns all-undefined fields when no JSON object is found.
 */
export const parseNotarySubmission = (stdout: string): NotarySubmission => {
  const start = stdout.indexOf("{");
  if (start === -1) {
    return { id: undefined, status: undefined, message: undefined };
  }
  try {
    const decoded = Schema.decodeUnknownSync(NotarySubmissionSchema, {
      onExcessProperty: "ignore",
    })(JSON.parse(stdout.slice(start)));
    return { id: decoded.id, status: decoded.status, message: decoded.message };
  } catch {
    return { id: undefined, status: undefined, message: undefined };
  }
};

/**
 * Parse whichever stream carries notarytool's JSON: stdout on success, but
 * stderr when `wait`/`submit --wait` times out (exit 124) or the call fails.
 */
export const parseNotaryResult = (result: ExecResult): NotarySubmission => {
  const fromStdout = parseNotarySubmission(result.stdout);
  return fromStdout.id !== undefined || fromStdout.message !== undefined
    ? fromStdout
    : parseNotarySubmission(result.stderr);
};

/** notarytool's exit status when `--timeout` elapses; the submission keeps processing. */
const NOTARY_TIMEOUT_EXIT = 124;

export const isNotaryTimeout = (result: ExecResult): boolean => {
  const { message } = parseNotaryResult(result);
  return (
    result.exitCode === NOTARY_TIMEOUT_EXIT ||
    (message !== undefined && /^Timeout of .* was reached/u.test(message))
  );
};

/** Best human-readable notarytool failure detail: parsed message, else raw streams. */
export const notaryFailureDetail = (result: ExecResult): string => {
  const parsed = parseNotaryResult(result);
  if (parsed.message !== undefined && parsed.message.length > 0) {
    return parsed.message;
  }
  return execFailureDetail(result);
};

// ── developer log ─────────────────────────────────────────────────

export interface NotaryIssue {
  readonly severity: string;
  /** Path inside the submission, without the archive's own name. */
  readonly path: string;
  readonly architecture: string | undefined;
  readonly message: string;
}

const NotaryLogSchema = Schema.Struct({
  archiveFilename: Schema.optional(Schema.String),
  issues: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          severity: Schema.String,
          path: Schema.String,
          architecture: Schema.optional(Schema.NullOr(Schema.String)),
          message: Schema.String,
        }),
      ),
    ),
  ),
});

/**
 * Pull the issue list out of `notarytool log <id>` JSON. Each issue names one
 * file and one architecture; paths are prefixed with the submitted archive's
 * name, which is noise to the user and is stripped. Unparseable logs yield no
 * issues (the caller then shows the raw log).
 */
export const parseNotaryLog = (json: string): readonly NotaryIssue[] => {
  const start = json.indexOf("{");
  if (start === -1) {
    return [];
  }
  try {
    const log = Schema.decodeUnknownSync(NotaryLogSchema, { onExcessProperty: "ignore" })(
      JSON.parse(json.slice(start)),
    );
    const prefix = log.archiveFilename === undefined ? undefined : `${log.archiveFilename}/`;
    return (log.issues ?? []).map((issue) => ({
      severity: issue.severity,
      path:
        prefix !== undefined && issue.path.startsWith(prefix)
          ? issue.path.slice(prefix.length)
          : issue.path,
      architecture: toOptional(issue.architecture),
      message: issue.message,
    }));
  } catch {
    return [];
  }
};

/**
 * One line per (path, message), with the affected architectures folded
 * together — the raw log repeats every issue once per slice of a universal
 * binary.
 */
const issueKey = (issue: NotaryIssue): string =>
  `${issue.severity}\u0000${issue.path}\u0000${issue.message}`;

export const formatNotaryIssues = (issues: readonly NotaryIssue[]): string =>
  [...new Set(issues.map(issueKey))]
    .flatMap((key) => {
      const group = issues.filter((issue) => issueKey(issue) === key);
      const [first] = group;
      if (first === undefined) {
        return [];
      }
      const archs = group
        .map((issue) => issue.architecture)
        .filter((arch): arch is string => arch !== undefined);
      const archSuffix = archs.length === 0 ? "" : ` (${archs.join(", ")})`;
      return [`  - [${first.severity}] ${first.path}${archSuffix}: ${first.message}`];
    })
    .join("\n");

// ── artifact classification ───────────────────────────────────────

/** What the notary service accepts, plus `.app` (zipped before submission). */
export type MacosArtifactKind = "app" | "dmg" | "pkg" | "zip";

export const classifyMacosArtifact = (artifactPath: string): MacosArtifactKind | null => {
  const lower = artifactPath.toLowerCase().replace(/\/+$/u, "");
  if (lower.endsWith(".app")) {
    return "app";
  }
  if (lower.endsWith(".dmg")) {
    return "dmg";
  }
  if (lower.endsWith(".pkg")) {
    return "pkg";
  }
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  return null;
};

/** `stapler` writes the ticket into the artifact; a `.zip` has nowhere to put it. */
export const canStaple = (kind: MacosArtifactKind): boolean => kind !== "zip";
