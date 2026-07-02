/**
 * Pure, framework-agnostic validators for the IAM path-glob SELECTOR GRAMMAR and
 * the action-token shape. Shared by web / CLI / server so all three reject bad
 * input identically. This is INPUT-SHAPE validation only — it is distinct from
 * the server matching algorithm (`selectorMatches`), which is NOT duplicated here.
 */

/** A selector segment: `*` or a non-empty token of `[A-Za-z0-9._:-]`. */
const SEGMENT_PATTERN = /^[A-Za-z0-9._:-]+$/u;

/**
 * An action token of `"<word>:<word>"` or `"<word>:*"`, where a word is a
 * non-empty run of `[A-Za-z0-9_-]`. The standalone `"*"` token is handled
 * separately in `isValidActionTokenShape`.
 */
const ACTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]+:(?:\*|[A-Za-z0-9_-]+)$/u;

const isValidSegment = (segment: string): boolean =>
  segment === "*" || SEGMENT_PATTERN.test(segment);

/**
 * A resource selector is valid when it is `"*"` OR is slash-joined segments where
 * each segment is `"*"` or a non-empty token of `[A-Za-z0-9._:-]`. Empty segments
 * (leading/trailing/double slashes) are rejected.
 */
export const isValidSelector = (selector: string): boolean => {
  if (selector === "*") {
    return true;
  }
  if (selector.length === 0) {
    return false;
  }
  return selector.split("/").every(isValidSegment);
};

/**
 * An action token is valid in SHAPE when it is `"*"`, `"<word>:<word>"`, or
 * `"<word>:*"`. The server still validates the token against the real
 * resource/action vocabulary — this only guards the grammar.
 */
export const isValidActionTokenShape = (token: string): boolean =>
  token === "*" || ACTION_TOKEN_PATTERN.test(token);

// Canonical resource-path templates the server's `resolvePath` can actually
// produce (auth/policy-match.ts). `ID` marks an id placeholder (any token, incl.
// `*`); every other entry is a fixed keyword segment.
const ID = "@";
const CANONICAL_TEMPLATES: readonly (readonly string[])[] = [
  ["org"],
  // Apple-team axis: `ID` is the 10-char Apple Team identifier (or the `none`
  // sentinel for team-less credentials). A bare `appleTeam/{ID}` selector covers
  // every credential under the team by prefix.
  ["appleTeam", ID],
  ["appleTeam", ID, "credential"],
  ["appleTeam", ID, "credential", ID],
  ["project", ID],
  ["project", ID, "build"],
  ["project", ID, "build", ID],
  ["project", ID, "credential"],
  ["project", ID, "credential", ID],
  ["project", ID, "submission"],
  ["project", ID, "submission", ID],
  ["project", ID, "env", ID],
  ["project", ID, "env", ID, "envVar"],
  ["project", ID, "env", ID, "envVar", ID],
  ["project", ID, "env", ID, "channel", ID],
  ["project", ID, "env", ID, "channel", ID, "update"],
  ["project", ID, "env", ID, "channel", ID, "update", ID],
  ["project", ID, "env", ID, "channel", ID, "rollout"],
  ["project", ID, "env", ID, "channel", ID, "rollout", ID],
];

const matchesTemplate = (template: readonly string[], segments: readonly string[]): boolean =>
  template.length === segments.length &&
  template.every((slot, index) => {
    const segment = segments[index];
    // Selector `*` satisfies a keyword position too (segment wildcard).
    return segment !== undefined && (slot === ID || segment === slot || segment === "*");
  });

/**
 * True when a (shape-valid) selector matches one of the canonical resource-path
 * templates the server can actually produce — so a typo'd or pluralised segment
 * (e.g. `"project/A/channels/X"`) is caught at policy-write time instead of being
 * stored as a silently inert policy that can never match. The standalone `"*"`
 * matches everything and is always canonical.
 */
export const isCanonicalSelector = (selector: string): boolean => {
  if (selector === "*") {
    return true;
  }
  const segments = selector.split("/");
  return CANONICAL_TEMPLATES.some((template) => matchesTemplate(template, segments));
};
