import { AuthContext, Forbidden } from "@better-update/api";
import { Effect } from "effect";

import type { Action, Resource, Role } from "@better-update/api";

export type { Action, Resource } from "@better-update/api";

type PermissionMap = Record<Role, Partial<Record<Resource, readonly Action[]>>>;

export const permissions: PermissionMap = {
  owner: {
    organization: ["read", "update", "delete"],
    member: ["read", "create", "update", "delete"],
    invitation: ["read", "create", "cancel"],
    project: ["read", "create", "update", "delete"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["read", "create", "update", "delete"],
    billing: ["read", "update"],
    apiKey: ["read", "create", "delete"],
    build: ["read", "create", "delete"],
    credential: ["read", "create", "download", "update", "delete"],
    envVar: ["read", "create", "update", "delete"],
  },
  admin: {
    organization: ["read"],
    member: ["read", "create", "update", "delete"],
    invitation: ["read", "create", "cancel"],
    project: ["read", "create", "update", "delete"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["read", "create", "update", "delete"],
    billing: ["read", "update"],
    apiKey: ["read", "create", "delete"],
    build: ["read", "create", "delete"],
    credential: ["read", "create", "download", "update", "delete"],
    envVar: ["read", "create", "update", "delete"],
  },
  developer: {
    project: ["read", "create"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["read", "create", "update", "delete"],
    apiKey: ["read"],
    build: ["read", "create"],
    credential: ["read", "download"],
    envVar: ["read", "create", "update"],
  },
  viewer: {
    organization: ["read"],
    member: ["read"],
    project: ["read"],
    channel: ["read"],
    branch: ["read"],
    update: ["read"],
    rollout: ["read"],
    build: ["read"],
    envVar: ["read"],
  },
};

export const assertPermission = (resource: Resource, action: Action) =>
  Effect.gen(function* () {
    const ctx = yield* AuthContext;
    const actions = ctx.effectivePermissions[resource];
    if (!actions?.includes(action)) {
      yield* new Forbidden({
        message: `Insufficient permission: ${resource}:${action}`,
      });
    }
  });
