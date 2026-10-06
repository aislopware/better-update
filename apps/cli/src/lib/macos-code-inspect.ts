/**
 * Read-only view of a code item's signature and entitlements, plus the
 * Developer ID distribution audit built on it. The audit catches, before a
 * notary round trip that can take hours, every defect the notary service and
 * Gatekeeper reject: missing hardened runtime, no secure timestamp, ad-hoc or
 * foreign signatures, `get-task-allow`, and restricted entitlements without an
 * embedded provisioning profile (which AMFI kills at launch).
 */
import { access } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { runTool } from "./exec-tool";
import { collectNestedCode, readBundleInfo } from "./macos-code-discovery";
import { parsePlistXml } from "./plist";

import type { NestedCodeItem } from "./macos-code-discovery";
import type { PlistObject } from "./plist";

// ── signature ─────────────────────────────────────────────────────

export interface CodeSignature {
  readonly signed: boolean;
  readonly identifier: string | undefined;
  readonly teamId: string | undefined;
  /** Leaf first, e.g. `Developer ID Application: Example Corp (ABCDE12345)`. */
  readonly authorities: readonly string[];
  /** A secure (`Timestamp=`) timestamp, not the unauthenticated `Signed Time=`. */
  readonly secureTimestamp: boolean;
  readonly adhoc: boolean;
  /** Signed only by the linker (what `ld`/cargo emit) — carries no real identity. */
  readonly linkerSigned: boolean;
  readonly runtime: boolean;
}

const UNSIGNED: CodeSignature = {
  signed: false,
  identifier: undefined,
  teamId: undefined,
  authorities: [],
  secureTimestamp: false,
  adhoc: false,
  linkerSigned: false,
  runtime: false,
};

/** Parse `codesign -dvvv` output (it writes to stderr). Exported for tests. */
export const parseCodesignDisplay = (output: string): CodeSignature => {
  if (/not signed at all/u.test(output)) {
    return UNSIGNED;
  }
  const lines = output.split("\n");
  const field = (name: string): string | undefined =>
    lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  const flags =
    /flags=0x[0-9a-f]+\((?<names>[^)]*)\)/u.exec(output)?.groups?.["names"]?.split(",") ?? [];
  const teamId = field("TeamIdentifier");
  return {
    signed: true,
    identifier: field("Identifier"),
    teamId: teamId === undefined || teamId === "not set" ? undefined : teamId,
    authorities: lines
      .filter((line) => line.startsWith("Authority="))
      .map((line) => line.slice("Authority=".length)),
    secureTimestamp: field("Timestamp") !== undefined,
    adhoc: field("Signature") === "adhoc" || flags.includes("adhoc"),
    linkerSigned: flags.includes("linker-signed"),
    runtime: flags.includes("runtime"),
  };
};

export const inspectSignature = (target: string) =>
  runTool("codesign", ["-dvvv", target]).pipe(
    Effect.map((result) =>
      result.exitCode === 0 ? parseCodesignDisplay(`${result.stdout}\n${result.stderr}`) : UNSIGNED,
    ),
  );

/** True when the signature carries a real identity worth preserving. */
export const hasRealIdentity = (signature: CodeSignature): boolean =>
  signature.signed && !signature.adhoc && !signature.linkerSigned;

// ── entitlements ──────────────────────────────────────────────────

/**
 * The entitlements currently embedded in `target`'s signature, or `undefined`
 * when it has none (unsigned, linker-signed, or signed without entitlements).
 */
export const readEntitlements = (target: string) =>
  runTool("codesign", ["-d", "--entitlements", "-", "--xml", target]).pipe(
    Effect.map((result): PlistObject | undefined => {
      const start = result.stdout.indexOf("<?xml");
      if (result.exitCode !== 0 || start === -1) {
        return undefined;
      }
      try {
        const parsed = parsePlistXml(result.stdout.slice(start));
        return Object.keys(parsed).length === 0 ? undefined : parsed;
      } catch {
        return undefined;
      }
    }),
  );

export const GET_TASK_ALLOW = "com.apple.security.get-task-allow";

/**
 * Entitlements safe to re-apply for Developer ID: everything except
 * `get-task-allow`, which the notary service rejects (Xcode strips it on
 * export; a re-sign must too). `undefined` when nothing remains.
 */
export const distributionEntitlements = (
  entitlements: PlistObject | undefined,
): PlistObject | undefined => {
  if (entitlements === undefined) {
    return undefined;
  }
  const kept = Object.fromEntries(
    Object.entries(entitlements).filter(([key]) => key !== GET_TASK_ALLOW),
  );
  return Object.keys(kept).length === 0 ? undefined : kept;
};

/**
 * Entitlements a Developer ID app may claim without a provisioning profile are
 * the `com.apple.security.*` family (TN3125): `get-task-allow`, App Groups, App
 * Sandbox, and the hardened-runtime `cs.*` exceptions. Everything else —
 * `com.apple.developer.*` (iCloud, push, associated domains, network/system
 * extensions), `keychain-access-groups`, `com.apple.application-identifier` —
 * is restricted and must be authorized by an embedded profile.
 */
export const restrictedEntitlements = (entitlements: PlistObject | undefined): readonly string[] =>
  entitlements === undefined
    ? []
    : Object.keys(entitlements).filter((key) => !key.startsWith("com.apple.security."));

/** Claimed by every bundle signed with a profile; they follow from it, not the reverse. */
const PROFILE_IDENTITY_KEYS = new Set([
  "com.apple.application-identifier",
  "com.apple.developer.team-identifier",
]);

/** Which of `entitlements` only a provisioning profile can authorize. */
export const entitlementsNeedingProfile = (
  entitlements: PlistObject | undefined,
): readonly string[] =>
  restrictedEntitlements(entitlements).filter((key) => !PROFILE_IDENTITY_KEYS.has(key));

// ── audit ─────────────────────────────────────────────────────────

export interface AuditIssue {
  /** Path relative to the audited app's parent (`My.app/Contents/...`). */
  readonly path: string;
  readonly message: string;
}

interface AuditTarget {
  readonly path: string;
  /** Executables (and executable bundles) need the hardened runtime. */
  readonly needsRuntime: boolean;
  /** Where an embedded profile would live, for bundles that can carry one. */
  readonly profilePath: string | undefined;
}

const exists = (filePath: string) =>
  Effect.promise(async () => {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  });

const toTarget = (item: NestedCodeItem): AuditTarget => {
  const isLibraryBundle = item.kind === "bundle" && item.path.toLowerCase().endsWith(".framework");
  return {
    path: item.path,
    needsRuntime: item.kind === "executable" || (item.kind === "bundle" && !isLibraryBundle),
    profilePath:
      item.kind === "bundle" && !isLibraryBundle
        ? path.join(item.path, "Contents", "embedded.provisionprofile")
        : undefined,
  };
};

const DEVELOPER_ID_APPLICATION = "Developer ID Application:";

const auditTarget = (target: AuditTarget, expectedTeamId: string | undefined) =>
  Effect.gen(function* () {
    const signature = yield* inspectSignature(target.path);
    if (!signature.signed) {
      return ["is not signed"];
    }
    const [leaf] = signature.authorities;
    const problems: string[] = [];
    if (!hasRealIdentity(signature) || leaf?.startsWith(DEVELOPER_ID_APPLICATION) !== true) {
      problems.push(
        `is signed by ${leaf ?? (signature.adhoc ? "an ad-hoc signature" : "an unknown identity")}, not a Developer ID Application certificate`,
      );
    }
    if (
      expectedTeamId !== undefined &&
      signature.teamId !== undefined &&
      signature.teamId !== expectedTeamId
    ) {
      problems.push(`is signed by team ${signature.teamId}, not ${expectedTeamId}`);
    }
    if (hasRealIdentity(signature) && !signature.secureTimestamp) {
      problems.push("has no secure timestamp (sign with --timestamp)");
    }
    if (target.needsRuntime && !signature.runtime) {
      problems.push("does not have the hardened runtime enabled");
    }
    const entitlements = yield* readEntitlements(target.path);
    if (entitlements?.[GET_TASK_ALLOW] === true) {
      problems.push(`carries ${GET_TASK_ALLOW}, which notarization rejects`);
    }
    const restricted = restrictedEntitlements(entitlements);
    if (restricted.length > 0 && target.profilePath !== undefined) {
      const hasProfile = yield* exists(target.profilePath);
      if (!hasProfile) {
        problems.push(
          `claims restricted entitlements (${restricted.join(", ")}) without an embedded Developer ID provisioning profile — it would be killed at launch`,
        );
      }
    }
    return problems;
  });

/**
 * Audit a signed `.app` for Developer ID distribution. Returns every problem
 * (empty = ready to notarize); the caller decides whether to fail. Main
 * executables are audited through their bundle, which is how Gatekeeper sees
 * them.
 */
export const auditDeveloperIdApp = (
  appPath: string,
  options: { readonly expectedTeamId?: string | undefined } = {},
) =>
  Effect.gen(function* () {
    const nested = yield* collectNestedCode(appPath);
    const bundles = nested.filter((item) => item.kind === "bundle");
    const mainExecutables = new Set(
      (yield* Effect.forEach([appPath, ...bundles.map((item) => item.path)], (bundlePath) =>
        readBundleInfo(bundlePath),
      ))
        .map((info) => info.mainExecutable)
        .filter((value): value is string => value !== undefined),
    );
    const targets: readonly AuditTarget[] = [
      toTarget({ path: appPath, kind: "bundle" }),
      ...nested.filter((item) => !mainExecutables.has(item.path)).map(toTarget),
    ];
    const relative = (target: string) => path.relative(path.dirname(appPath), target);
    const perTarget = yield* Effect.all(
      targets.map((target) =>
        auditTarget(target, options.expectedTeamId).pipe(
          Effect.map((problems) =>
            problems.map(
              (message) => ({ path: relative(target.path), message }) satisfies AuditIssue,
            ),
          ),
        ),
      ),
    );
    return perTarget.flat();
  });

/** One line per issue, for error messages. */
export const formatAuditIssues = (issues: readonly AuditIssue[]): string =>
  issues.map((issue) => `  - ${issue.path} ${issue.message}`).join("\n");
