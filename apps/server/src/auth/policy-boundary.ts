// Pure permission-boundary check for policy attachment — the IAM "no privilege
// escalation" / permissions-boundary rule. A non-owner principal may attach a
// policy to a principal ONLY if every permission the policy would GRANT is one
// the attaching principal itself already holds. Owners/superadmins bypass this
// (applied by the caller). No I/O — unit-tested directly. See
// docs/specs/authz/POLICY-GROUPS-SPEC.md §7.

import { selectorMatches } from "./policy-match";

import type { PolicyDocument, PolicyStatement } from "../authz-models";

// Does the caller's action token cover (subsume) a granted action token?
//   "*" covers everything; "res:*" covers "res:x" and "res:*"; otherwise exact.
const tokenSubsumes = (callerToken: string, grantToken: string): boolean => {
  if (callerToken === "*") {
    return true;
  }
  if (callerToken === grantToken) {
    return true;
  }
  if (callerToken.endsWith(":*")) {
    const resource = callerToken.slice(0, -2);
    return grantToken === `${resource}:*` || grantToken.startsWith(`${resource}:`);
  }
  return false;
};

const tokensOverlap = (left: string, right: string): boolean =>
  tokenSubsumes(left, right) || tokenSubsumes(right, left);

// `selectorMatches(a, b)` answers "does selector a cover path b" — used here as
// "does caller selector a subsume granted selector b". Overlap = either covers.
const selectorsOverlap = (left: string, right: string): boolean =>
  selectorMatches(left, right) || selectorMatches(right, left);

// Some single caller ALLOW must subsume BOTH the action token and the selector:
// a permission is conferred by one statement, never by mixing two.
const callerAllowSubsumes = (
  caller: readonly PolicyStatement[],
  token: string,
  selector: string,
): boolean =>
  caller.some(
    (statement) =>
      statement.effect === "allow" &&
      statement.actions.some((callerToken) => tokenSubsumes(callerToken, token)) &&
      statement.resources.some((callerSelector) => selectorMatches(callerSelector, selector)),
  );

// Conservative deny check: any caller DENY whose action+selector could intersect
// the granted (token, selector) blocks it — the caller cannot grant a permission
// it is itself (partially) denied.
const callerDenyIntersects = (
  caller: readonly PolicyStatement[],
  token: string,
  selector: string,
): boolean =>
  caller.some(
    (statement) =>
      statement.effect === "deny" &&
      statement.actions.some((denyToken) => tokensOverlap(denyToken, token)) &&
      statement.resources.some((denySelector) => selectorsOverlap(denySelector, selector)),
  );

/**
 * True when `caller` may grant `granted` — every (action, resource) pair the
 * document's ALLOW statements confer is subsumed by one of the caller's own
 * allows and intersected by none of the caller's denies. DENY statements in
 * `granted` are restrictions (never escalation), so they impose no requirement;
 * an empty or allow-free document is always within bounds. Owners/superadmins
 * bypass this entirely and must be short-circuited by the caller.
 */
export const isWithinBoundary = (
  caller: readonly PolicyStatement[],
  granted: PolicyDocument,
): boolean =>
  granted.statements
    .filter((statement) => statement.effect === "allow")
    .every((statement) =>
      statement.actions.every((token) =>
        statement.resources.every(
          (selector) =>
            callerAllowSubsumes(caller, token, selector) &&
            !callerDenyIntersects(caller, token, selector),
        ),
      ),
    );
