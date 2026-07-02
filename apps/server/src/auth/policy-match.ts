// Pure matching primitives for the IAM policy evaluator. No I/O, no Effect
// services — unit-tested directly. See docs/specs/authz/POLICY-GROUPS-SPEC.md §6.

import type { ObjectRef, PolicyStatement } from "../authz-models";

/**
 * Does a statement's action-token list cover `action` ("resource:action")?
 * Matches "*", the exact token, or the per-resource wildcard "resource:*".
 */
export const actionMatches = (statementActions: readonly string[], action: string): boolean => {
  const resource = action.slice(0, action.indexOf(":"));
  return statementActions.some(
    (token) => token === "*" || token === action || token === `${resource}:*`,
  );
};

/**
 * Segment-prefix match with `*` wildcard (matches exactly one segment).
 *   selectorMatches("project/A", "project/A/env/E1/...") === true
 *   selectorMatches("project/*\/env/production", "project/B/env/production") === true
 *   selectorMatches("*", anything) === true
 *   selectorMatches("project/A", "org") === false
 * A selector deeper than the target never matches.
 */
export const selectorMatches = (selector: string, path: string): boolean => {
  if (selector === "*") {
    return true;
  }
  const selectorSegments = selector.split("/");
  const pathSegments = path.split("/");
  if (selectorSegments.length > pathSegments.length) {
    return false;
  }
  return selectorSegments.every(
    (segment, index) => segment === "*" || segment === pathSegments[index],
  );
};

/** Resolve an {@link ObjectRef} to its canonical path string (SPEC §2). Total. */
export const resolvePath = (ref: ObjectRef): string => {
  switch (ref.kind) {
    case "org": {
      return "org";
    }
    case "appleCredential": {
      const base = `appleTeam/${ref.appleTeamId}/credential`;
      return ref.credentialId === undefined ? base : `${base}/${ref.credentialId}`;
    }
    case "project": {
      return `project/${ref.projectId}`;
    }
    case "build": {
      return ref.buildId === undefined
        ? `project/${ref.projectId}/build`
        : `project/${ref.projectId}/build/${ref.buildId}`;
    }
    case "credential": {
      return ref.credentialId === undefined
        ? `project/${ref.projectId}/credential`
        : `project/${ref.projectId}/credential/${ref.credentialId}`;
    }
    case "submission": {
      return ref.submissionId === undefined
        ? `project/${ref.projectId}/submission`
        : `project/${ref.projectId}/submission/${ref.submissionId}`;
    }
    case "environment": {
      return `project/${ref.projectId}/env/${ref.environment}`;
    }
    case "envVar": {
      return ref.key === undefined
        ? `project/${ref.projectId}/env/${ref.environment}/envVar`
        : `project/${ref.projectId}/env/${ref.environment}/envVar/${ref.key}`;
    }
    case "channel": {
      return `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
    }
    case "update": {
      const base = `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
      return ref.updateId === undefined ? `${base}/update` : `${base}/update/${ref.updateId}`;
    }
    case "rollout": {
      const base = `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
      return ref.rolloutId === undefined ? `${base}/rollout` : `${base}/rollout/${ref.rolloutId}`;
    }
    default: {
      // Exhaustiveness: `ObjectRef` is a closed tagged union, so `ref` is `never`
      // here. A newly added kind without a case above fails to type-check instead
      // of silently falling through to the org path (which could accidentally
      // grant or deny the new resource).
      return ref satisfies never;
    }
  }
};

/**
 * Which projects can this actor READ (`project:read` at the `project/{id}`
 * path)? `{ kind: "all", except }` when any allow selector covers every project
 * (`*`, `project`, `project/*`), with per-id denies carried as `except`;
 * otherwise `{ kind: "ids", ids }` — literal allow segments minus denies (a
 * deny on `*`/`project/*` empties it). Owner/superadmin bypass is applied by
 * the caller. Feeds server-side list filtering (SPEC §5a) — per-object gates
 * stay on `assertAccess`.
 */
export type ProjectReadScope =
  | { readonly kind: "all"; readonly except: ReadonlySet<string> }
  | { readonly kind: "ids"; readonly ids: ReadonlySet<string> };

// Which project ids does a selector cover AT the `project/{id}` path itself?
// Mirrors `selectorMatches`: a selector deeper than `project/{id}` never
// matches the project path, so it grants/denies nothing here.
const projectSegment = (selector: string): string | null => {
  if (selector === "*") {
    return "*";
  }
  const [head, segment, ...deeper] = selector.split("/");
  if (head !== "project") {
    return null;
  }
  // Selector "project" (one segment) prefixes every `project/{id}` path.
  if (segment === undefined) {
    return "*";
  }
  return deeper.length === 0 && segment.length > 0 ? segment : null;
};

export const accessibleProjectIds = (statements: readonly PolicyStatement[]): ProjectReadScope => {
  const token = "project:read";
  const segmentsFor = (effect: "allow" | "deny"): readonly string[] =>
    statements
      .filter((stmt) => stmt.effect === effect && actionMatches(stmt.actions, token))
      .flatMap((stmt) => stmt.resources.map(projectSegment))
      .filter((segment): segment is string => segment !== null);

  const denied = new Set(segmentsFor("deny"));
  if (denied.has("*")) {
    return { kind: "ids", ids: new Set<string>() };
  }
  const allowed = segmentsFor("allow");
  if (allowed.includes("*")) {
    return { kind: "all", except: denied };
  }
  return { kind: "ids", ids: new Set(allowed.filter((segment) => !denied.has(segment))) };
};

/**
 * Deny-wins, default-deny resolution of a token+path against a flat statement
 * list. Owner/superadmin bypass is applied by the caller (auth/policy.ts).
 */
export const isAllowed = (
  statements: readonly PolicyStatement[],
  action: string,
  path: string,
): boolean => {
  const matching = statements.filter(
    (stmt) =>
      actionMatches(stmt.actions, action) &&
      stmt.resources.some((selector) => selectorMatches(selector, path)),
  );
  if (matching.some((stmt) => stmt.effect === "deny")) {
    return false;
  }
  return matching.some((stmt) => stmt.effect === "allow");
};
