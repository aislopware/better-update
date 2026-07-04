// Org-shared Android/Google credential gate (GITLAB-RBAC-SPEC §1a/§3b, v2).
// Upload keystores and Google service-account keys are org-scoped rows with a
// PER-ROW protected flag and PER-ROW project bindings: the base rank
// (developer, delete = maintainer; protected ⇒ maintainer for every action)
// must be held on some project the row is bound to — unbound rows are
// admin-only. Handlers load the row anyway, so they pass its flag + row id
// in; the binding set is resolved here. Creation is gated by
// {@link assertAndroidOrgCredentialCreate} (auto-bind path).

import { Effect } from "effect";

import { Forbidden } from "../errors";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import { bindingHint } from "./binding-hint";
import { CurrentActor } from "./current-actor";
import {
  boundCredentialAllowed,
  CREDENTIAL_RULES,
  credentialRequiredRank,
  effectiveProjectRole,
  projectRoleAtLeast,
} from "./role-matrix";

import type { Action, CredentialBindingType, ProjectRole } from "../models";

const baseRank = (action: Action): ProjectRole =>
  CREDENTIAL_RULES[`androidCredential:${action}`] ?? "maintainer";

const denied = (
  action: Action,
  isProtected: boolean,
  resourceType: AndroidBindingType,
  resourceId: string,
) => {
  const requirement = isProtected
    ? "this credential is protected (requires the Maintainer role on a project it is bound to)"
    : "requires access via a project this credential is bound to";
  return new Forbidden({
    message: `Insufficient permission: androidCredential:${action} — ${requirement}; ${bindingHint(resourceType, resourceId)}`,
  });
};

export type AndroidBindingType = Extract<
  CredentialBindingType,
  "googleServiceAccountKey" | "androidUploadKeystore"
>;

/**
 * Gate an action on an EXISTING org-shared Android credential row: protected
 * flag + binding set decide (spec §1a). Admin-tier actors bypass.
 */
export const assertAndroidOrgCredentialAccess = (params: {
  readonly action: Action;
  readonly resourceType: AndroidBindingType;
  readonly resourceId: string;
  readonly isProtected: boolean;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return;
    }
    const bound = yield* ProjectCredentialBindingRepo.pipe(
      Effect.flatMap((repo) =>
        repo.boundProjectIds({
          organizationId: ctx.organizationId,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
        }),
      ),
    );
    const required = credentialRequiredRank(baseRank(params.action), params.isProtected);
    if (!boundCredentialAllowed(ctx, bound, required)) {
      return yield* denied(
        params.action,
        params.isProtected,
        params.resourceType,
        params.resourceId,
      );
    }
  });

/**
 * Gate for creating a NEW org-shared Android credential (spec §1a): admins
 * always; a member needs Maintainer on the `projectId` the row will be
 * auto-bound to — without a projectId, creation is admin-only (the row would
 * be born unbound and unusable).
 */
export const assertAndroidOrgCredentialCreate = (params: {
  readonly projectId?: string | undefined;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return;
    }
    if (
      params.projectId === undefined ||
      !projectRoleAtLeast(effectiveProjectRole(ctx, params.projectId), "maintainer")
    ) {
      return yield* new Forbidden({
        message:
          "Creating a new credential requires the Maintainer role on the target project (pass projectId) or org admin",
      });
    }
  });

/**
 * Filter org-shared Android credential rows to the ones the actor may READ
 * under the binding gate — one bindings query per list.
 */
export const filterAndroidOrgCredentialRead = <T>(
  items: readonly T[],
  resourceType: AndroidBindingType,
  rowOf: (item: T) => { readonly id: string; readonly isProtected: boolean },
) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return items;
    }
    const bindings = yield* ProjectCredentialBindingRepo.pipe(
      Effect.flatMap((repo) =>
        repo.boundProjectIdsByResource({
          organizationId: ctx.organizationId,
          resourceType,
        }),
      ),
    );
    return items.filter((item) => {
      const row = rowOf(item);
      return boundCredentialAllowed(
        ctx,
        bindings[row.id] ?? [],
        credentialRequiredRank(baseRank("read"), row.isProtected),
      );
    });
  });
