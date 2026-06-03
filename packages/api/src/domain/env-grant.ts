import { Schema } from "effect";

import { GrantEffectSchema } from "./channel-grant";
import { DateTimeString, Id } from "./common";
import { EnvVarEnvironment } from "./env-var";

/**
 * One member's allow/deny set on a (project × environment) env-var scope.
 * `scopeKind` is fixed to "env_var_environment". `scopeId` is the encoded
 * `<projectId|global>:<environment>` token (server-built). `actions` are
 * "resource:action" tokens (here always envVar:*).
 */
export class EnvGrant extends Schema.Class<EnvGrant>("EnvGrant")({
  id: Id,
  memberId: Id,
  scopeKind: Schema.Literal("env_var_environment"),
  scopeId: Schema.String,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
  createdAt: DateTimeString,
}) {}

/** A flattened row for the list UI: one member × environment cell. */
export class EnvGrantRow extends Schema.Class<EnvGrantRow>("EnvGrantRow")({
  memberId: Id,
  environment: EnvVarEnvironment,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
}) {}

/**
 * URL params for listing grants on a project-or-global scope. `projectId` is the
 * sentinel "global" or a real project id (the server resolves null vs the
 * sentinel). Carried as a query param.
 */
export const ListEnvGrantsParams = Schema.Struct({
  projectId: Schema.String,
});

/**
 * Upsert one (member, project-or-global, environment) grant. `projectId` null =
 * org-global vault. effect defaults to "allow". actions are envVar:* tokens.
 */
export const UpsertEnvGrantBody = Schema.Struct({
  memberId: Id,
  projectId: Schema.NullOr(Id),
  environment: EnvVarEnvironment,
  effect: Schema.optionalWith(GrantEffectSchema, { default: () => "allow" as const }),
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});

/** Delete both effects for (member, project-or-global, environment). */
export const DeleteEnvGrantBody = Schema.Struct({
  memberId: Id,
  projectId: Schema.NullOr(Id),
  environment: EnvVarEnvironment,
});

export const DeleteEnvGrantResult = Schema.Struct({ deleted: Schema.Number });
