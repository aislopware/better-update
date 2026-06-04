import { isCanonicalSelector, isValidActionTokenShape, isValidSelector } from "@better-update/api";
import { Data, Effect } from "effect";

export class PolicyCommandError extends Data.TaggedError("PolicyCommandError")<{
  readonly message: string;
}> {}

export const policyErrorExtras = { PolicyCommandError: 2 } as const;

/** A managed preset id is virtual + read-only; its id is prefixed with `managed:`. */
export const isManagedPolicyId = (id: string): boolean => id.startsWith("managed:");

interface ParsedStatement {
  readonly effect: "allow" | "deny";
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

interface ParsedDocument {
  readonly statements: readonly ParsedStatement[];
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse + shape-validate a `--document` JSON string client-side so a malformed
 * document fails with a clear local message before any network round-trip. The
 * server still re-validates action tokens against the real vocabulary and the
 * selectors against the shared grammar; this only guards the JSON shape and the
 * action/selector token SHAPE via the contract's pure validators.
 *
 * Expected shape:
 *   { "statements": [ { "effect": "allow"|"deny", "actions": ["project:read"|"*"], "resources": ["*"|"project/A"] } ] }
 */
export const parsePolicyDocument = (
  raw: string,
): Effect.Effect<ParsedDocument, PolicyCommandError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () =>
        new PolicyCommandError({
          message: "The --document value is not valid JSON. Pass a JSON object string.",
        }),
    });
    if (!isRecord(parsed) || !Array.isArray(parsed["statements"])) {
      return yield* new PolicyCommandError({
        message:
          'The document must be a JSON object with a "statements" array. Example: ' +
          '{"statements":[{"effect":"allow","actions":["project:read"],"resources":["*"]}]}',
      });
    }
    const statements: ParsedStatement[] = [];
    for (const [index, entry] of parsed["statements"].entries()) {
      const statement = yield* validateStatement(entry, index);
      statements.push(statement);
    }
    if (statements.length === 0) {
      return yield* new PolicyCommandError({
        message: "The document must contain at least one statement.",
      });
    }
    return { statements };
  });

const validateStatement = (
  entry: unknown,
  index: number,
): Effect.Effect<ParsedStatement, PolicyCommandError> =>
  Effect.gen(function* () {
    const at = `statements[${index}]`;
    if (!isRecord(entry)) {
      return yield* new PolicyCommandError({ message: `${at} must be a JSON object.` });
    }
    const { effect } = entry;
    if (effect !== "allow" && effect !== "deny") {
      return yield* new PolicyCommandError({
        message: `${at}.effect must be "allow" or "deny".`,
      });
    }
    const { actions } = entry;
    if (!isStringArray(actions) || actions.length === 0) {
      return yield* new PolicyCommandError({
        message: `${at}.actions must be a non-empty array of action-token strings.`,
      });
    }
    const badAction = actions.find((token) => !isValidActionTokenShape(token));
    if (badAction !== undefined) {
      return yield* new PolicyCommandError({
        message: `${at}.actions has an invalid token "${badAction}". Use "*", "<resource>:*", or "<resource>:<action>".`,
      });
    }
    const { resources } = entry;
    if (!isStringArray(resources) || resources.length === 0) {
      return yield* new PolicyCommandError({
        message: `${at}.resources must be a non-empty array of selector strings.`,
      });
    }
    const badResource = resources.find((selector) => !isValidSelector(selector));
    if (badResource !== undefined) {
      return yield* new PolicyCommandError({
        message: `${at}.resources has an invalid selector "${badResource}". Use "*" or slash-joined segments like "project/A".`,
      });
    }
    const inertResource = resources.find((selector) => !isCanonicalSelector(selector));
    if (inertResource !== undefined) {
      return yield* new PolicyCommandError({
        message: `${at}.resources selector "${inertResource}" matches no known resource path. Use segments like "project/{id}/channel/{id}" or "project/{id}/env/{env}".`,
      });
    }
    return { effect, actions, resources };
  });
