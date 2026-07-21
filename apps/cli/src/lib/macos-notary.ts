/**
 * Thin wrappers around the macOS notarization toolchain: `xcrun notarytool`
 * (submit/log/info), `xcrun stapler` (staple/validate), and `ditto` (zip an
 * `.app` for submission). Follows the altool.ts contract — tools never fail
 * the Effect; failures come back as an {@link ExecResult} with a non-zero exit
 * and the real reason is parsed out of notarytool's `--output-format json`
 * stdout.
 */
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

/** Best human-readable notarytool failure detail: parsed message, else raw streams. */
export const notaryFailureDetail = (result: ExecResult): string => {
  const parsed = parseNotarySubmission(result.stdout);
  if (parsed.message !== undefined && parsed.message.length > 0) {
    return parsed.message;
  }
  return execFailureDetail(result);
};

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
