import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/**
 * Resource kinds a credential→project binding can point at (GITLAB-RBAC-SPEC
 * §1a/§3c). `appleTeam` cascades to every child credential and the team's
 * devices; `ascApiKey` binds ONLY team-less keys; the android kinds bind
 * per-row.
 */
export const CredentialBindingType = Schema.Literal(
  "appleTeam",
  "ascApiKey",
  "googleServiceAccountKey",
  "androidUploadKeystore",
);
export type CredentialBindingTypeValue = typeof CredentialBindingType.Type;

export class CredentialBinding extends Schema.Class<CredentialBinding>("CredentialBinding")({
  id: Id,
  organizationId: Id,
  projectId: Id,
  resourceType: CredentialBindingType,
  resourceId: Id,
  createdAt: DateTimeString,
  /**
   * True when this entry comes from the resource's ORG-WIDE binding (bound to
   * every project, present and future) rather than an explicit per-project
   * row. Remove it with the all-projects unbind route, not the per-project one.
   */
  allProjects: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export const CredentialBindingList = Schema.Struct({
  items: Schema.Array(CredentialBinding),
});

/**
 * An org-wide ("all projects") binding: the resource is usable in EVERY
 * project of the org — including projects created later, with no per-project
 * fan-out. `appleTeam` rows cascade to every child credential and the team's
 * devices, exactly like per-project bindings.
 */
export class OrgCredentialBinding extends Schema.Class<OrgCredentialBinding>(
  "OrgCredentialBinding",
)({
  id: Id,
  organizationId: Id,
  resourceType: CredentialBindingType,
  resourceId: Id,
  createdAt: DateTimeString,
}) {}

/**
 * One binding an existing project config relies on (derived from iOS bundle
 * configurations + Android build-credential groups): what an org admin would
 * bind so that config keeps resolving under the v2 binding gate (§1a). Backs
 * `credentials bindings plan [--apply]` for post-migration bulk re-binding.
 */
export class CredentialBindingPlanItem extends Schema.Class<CredentialBindingPlanItem>(
  "CredentialBindingPlanItem",
)({
  projectId: Id,
  projectName: Schema.String,
  resourceType: CredentialBindingType,
  resourceId: Id,
  /** Human-readable resource identity (team id/name, key name, client email…). */
  resourceLabel: Schema.String,
  alreadyBound: Schema.Boolean,
}) {}

export const CredentialBindingPlan = Schema.Struct({
  items: Schema.Array(CredentialBindingPlanItem),
});

/**
 * Projects an org credential is bound to — carried on credential list/detail
 * responses so UIs can render binding chips without an extra round trip.
 */
export const boundProjectIdsField = {
  boundProjectIds: Schema.Array(Id),
  /**
   * True when the credential (or, for team-scoped rows, its Apple team) is
   * bound org-wide — `boundProjectIds` then already contains every project id,
   * and projects created later are covered automatically.
   */
  boundToAllProjects: Schema.optionalWith(Schema.Boolean, { default: () => false }),
} as const;

/**
 * Optional auto-bind target on credential CREATE payloads (spec §1a): an org
 * admin may pass any project; a member must pass a project they maintain —
 * the new credential (or its Apple team) is bound to it in the same request.
 */
export const credentialCreateBindingField = {
  projectId: Schema.optional(Id),
} as const;
