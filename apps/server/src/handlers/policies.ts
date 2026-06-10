import { isCanonicalSelector, isValidSelector, Policy } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { isManagedPolicyId, MANAGED_POLICIES, MANAGED_POLICY_LIST } from "../auth/managed-policies";
import { permissions } from "../auth/permissions";
import { assertAccess } from "../auth/policy";
import { BadRequest, Conflict, NotFound } from "../errors";
import { toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { PolicyRepo } from "../repositories/policy-repo";
import { reconcileVaultAccess } from "./reconcile-vault-access";

import type { PolicyDocument, PolicyModel, Resource } from "../models";

// The set of every concrete `resource:action` token (e.g. "channel:create") the
// owner preset enumerates — the authoritative action-token vocabulary. Plus the
// set of known resource names so `resource:*` wildcards can be validated.
const VALID_ACTION_TOKENS: ReadonlySet<string> = new Set(
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Object.entries widens keys to string; permissions.owner is typed Partial<Record<Resource, Action[]>>
  (Object.entries(permissions.owner) as [Resource, readonly string[]][]).flatMap(
    ([resource, actions]) => actions.map((action) => `${resource}:${action}`),
  ),
);

const KNOWN_RESOURCES: ReadonlySet<string> = new Set(Object.keys(permissions.owner));

const isValidActionToken = (token: string): boolean => {
  if (token === "*") {
    return true;
  }
  if (VALID_ACTION_TOKENS.has(token)) {
    return true;
  }
  const [resource, action] = token.split(":");
  return action === "*" && resource !== undefined && KNOWN_RESOURCES.has(resource);
};

// Validate a policy document against the real resource/action vocabulary + the
// shared selector grammar. Fails BadRequest on the first offending token/selector.
const assertValidPolicyDocument = (document: PolicyDocument) =>
  Effect.gen(function* () {
    const badToken = document.statements
      .flatMap((statement) => statement.actions)
      .find((token) => !isValidActionToken(token));
    if (badToken !== undefined) {
      return yield* new BadRequest({ message: `Unknown action token: ${badToken}` });
    }
    const selectors = document.statements.flatMap((statement) => statement.resources);
    const badSelector = selectors.find((selector) => !isValidSelector(selector));
    if (badSelector !== undefined) {
      return yield* new BadRequest({ message: `Invalid resource selector: ${badSelector}` });
    }
    // Reject selectors whose keyword segments don't match any real resource path
    // (e.g. a pluralised "channels"): such a policy would be silently inert.
    const inertSelector = selectors.find((selector) => !isCanonicalSelector(selector));
    if (inertSelector !== undefined) {
      return yield* new BadRequest({
        message: `Selector matches no known resource path: ${inertSelector}`,
      });
    }
  });

const toApiPolicy = (model: PolicyModel) =>
  new Policy({
    id: model.id,
    organizationId: model.organizationId,
    name: model.name,
    description: model.description,
    document: model.document,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const PoliciesGroupLive = HttpApiBuilder.group(ManagementApi, "policies", (handlers) =>
  handlers
    .handle("list", () =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("policy", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* PolicyRepo;
          const custom = yield* repo.list({ organizationId: ctx.organizationId });
          const items = [...MANAGED_POLICY_LIST, ...custom].map(toApiPolicy);
          return { items };
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("policy", "create");
          yield* assertValidPolicyDocument(payload.document);
          const ctx = yield* CurrentActor;
          const repo = yield* PolicyRepo;
          const created = yield* repo.create({
            organizationId: ctx.organizationId,
            name: payload.name,
            description: toDbNull(payload.description),
            document: payload.document,
          });
          yield* logAudit({
            action: "policy.create",
            resourceType: "policy",
            resourceId: created.id,
            metadata: { name: created.name },
          });
          return toApiPolicy(created);
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("policy", "read");
          if (isManagedPolicyId(path.id)) {
            return toApiPolicy(MANAGED_POLICIES[path.id]);
          }
          const ctx = yield* CurrentActor;
          const repo = yield* PolicyRepo;
          const policy = yield* repo.findById({ id: path.id, organizationId: ctx.organizationId });
          if (policy === null) {
            return yield* new NotFound({ message: "Policy not found" });
          }
          return toApiPolicy(policy);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("policy", "update");
          if (isManagedPolicyId(path.id)) {
            return yield* new Conflict({ message: "Managed presets are read-only" });
          }
          if (payload.document !== undefined) {
            yield* assertValidPolicyDocument(payload.document);
          }
          const ctx = yield* CurrentActor;
          const repo = yield* PolicyRepo;
          const updated = yield* repo.update({
            id: path.id,
            organizationId: ctx.organizationId,
            ...(payload.name === undefined ? {} : { name: payload.name }),
            ...(payload.description === undefined ? {} : { description: payload.description }),
            ...(payload.document === undefined ? {} : { document: payload.document }),
          });
          if (updated === null) {
            return yield* new NotFound({ message: "Policy not found" });
          }
          yield* logAudit({
            action: "policy.update",
            resourceType: "policy",
            resourceId: path.id,
          });
          // A narrowed document may strip `vaultAccess` from every member/group
          // this policy is attached to — reconcile when the document changed.
          if (payload.document !== undefined) {
            yield* reconcileVaultAccess({
              organizationId: ctx.organizationId,
              reason: `policy-updated:${path.id}`,
            });
          }
          return toApiPolicy(updated);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("policy", "delete");
          if (isManagedPolicyId(path.id)) {
            return yield* new Conflict({ message: "Managed presets are read-only" });
          }
          const ctx = yield* CurrentActor;
          const repo = yield* PolicyRepo;
          const deleted = yield* repo.delete({ id: path.id, organizationId: ctx.organizationId });
          if (!deleted) {
            return yield* new NotFound({ message: "Policy not found" });
          }
          yield* logAudit({
            action: "policy.delete",
            resourceType: "policy",
            resourceId: path.id,
          });
          // Deleting the policy cascades its attachments, so any member/group that
          // held it may lose `vaultAccess` — reconcile the recipient set.
          yield* reconcileVaultAccess({
            organizationId: ctx.organizationId,
            reason: `policy-deleted:${path.id}`,
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
