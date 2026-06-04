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
      return `project/${ref.projectId}/channel/${ref.channelId}`;
    }
    case "update": {
      return ref.updateId === undefined
        ? `project/${ref.projectId}/channel/${ref.channelId}/update`
        : `project/${ref.projectId}/channel/${ref.channelId}/update/${ref.updateId}`;
    }
    case "rollout": {
      return ref.rolloutId === undefined
        ? `project/${ref.projectId}/channel/${ref.channelId}/rollout`
        : `project/${ref.projectId}/channel/${ref.channelId}/rollout/${ref.rolloutId}`;
    }
    default: {
      return "org";
    }
  }
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
