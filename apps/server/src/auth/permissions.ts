// Org-level gate conveniences. The role×action matrix itself lives in
// ./role-matrix.ts (docs/specs/authz/GITLAB-RBAC-SPEC.md §2); the runtime gate
// is `assertAccess` in ./policy.ts.

import { assertAccess, assertSuperadmin } from "./policy";

import type { Action, Resource } from "../models";

// Org-level convenience over `assertAccess` (target defaults to `{ kind: "org" }`).
// Use for genuinely org-scoped resources (member, billing, robotAccount, devices,
// webhooks, vault, org-shared credentials, audit). Object-scopeable resources call
// `assertAccess` directly with a structured `ObjectRef`.
export const assertPermission = (resource: Resource, action: Action) =>
  assertAccess(resource, action);

export { assertSuperadmin };
