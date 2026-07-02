import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/**
 * The three built-in environments present in every organization. They are
 * **virtual** — not stored as rows. They always exist, can never be renamed or
 * deleted, and seed nothing. User-defined environments live in the
 * `environments` table; a list endpoint merges these built-ins in front of them.
 */
export const BUILTIN_ENVIRONMENTS = ["development", "preview", "production"] as const;

/**
 * An environment name: lowercase letters, digits and hyphens, starting with a
 * letter. Shared by the env-var `environment` axis and the environment entity so
 * a custom environment name and an env var's `environment` use one shape.
 */
export const EnvironmentName = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/u),
  Schema.maxLength(64),
);

/** An organization environment: a built-in (virtual) or a user-defined row. */
export class Environment extends Schema.Class<Environment>("Environment")({
  id: Id,
  organizationId: Id,
  name: EnvironmentName,
  isBuiltin: Schema.Boolean,
  /**
   * Protected environments (ROLES-CAPABILITIES-SPEC §2d): writes into them
   * additionally require `environment:update` (Maintainer+ / Admin / a custom
   * grant). `production` ships protected in every org.
   */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
}) {}

export const EnvironmentListResult = Schema.Struct({
  items: Schema.Array(Environment),
});

export const CreateEnvironmentBody = Schema.Struct({
  name: EnvironmentName,
});

export const RenameEnvironmentBody = Schema.Struct({
  name: EnvironmentName,
});

export const DeleteEnvironmentResult = Schema.Struct({ deleted: Schema.Number });
