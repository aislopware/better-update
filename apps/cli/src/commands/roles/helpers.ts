import { Data, Effect } from "effect";

export class RoleCommandError extends Data.TaggedError("RoleCommandError")<{
  readonly message: string;
}> {}

export const roleErrorExtras = { RoleCommandError: 2 } as const;

/**
 * Parse comma-separated "resource:action" tokens into the PermissionGrant array
 * the API expects. Multiple actions for the same resource are grouped.
 *
 * Input examples:
 *   "channel:read,channel:update"
 *   "channel:read, rollout:create, rollout:update"
 */
export const parsePermissionTokens = (
  raw: string,
): Effect.Effect<
  { readonly resource: string; readonly actions: readonly string[] }[],
  RoleCommandError
> =>
  Effect.gen(function* () {
    const tokens = raw
      .split(",")
      .map((tok) => tok.trim())
      .filter((tok) => tok.length > 0);

    const grouped = new Map<string, Set<string>>();
    for (const token of tokens) {
      const colonIdx = token.indexOf(":");
      if (colonIdx === -1) {
        return yield* new RoleCommandError({
          message: `Invalid permission token "${token}" — expected "resource:action" format.`,
        });
      }
      const resource = token.slice(0, colonIdx).trim();
      const action = token.slice(colonIdx + 1).trim();
      if (!resource || !action) {
        return yield* new RoleCommandError({
          message: `Invalid permission token "${token}" — resource and action must be non-empty.`,
        });
      }
      const actions = grouped.get(resource) ?? new Set<string>();
      actions.add(action);
      grouped.set(resource, actions);
    }

    return [...grouped.entries()].map(([resource, actions]) => ({
      resource,
      actions: [...actions],
    }));
  });
