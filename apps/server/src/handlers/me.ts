import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { meetsAnywhereRequirement, meetsOrgRequirement, ORG_RULES } from "../auth/role-matrix";
import { AssetStorage } from "../cloudflare/asset-storage";
import { cloudflareEnv } from "../cloudflare/context";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect, toApiCrudEffect } from "../http/to-api-effect";
import { AuthMetaRepo } from "../repositories/auth-meta";
import { LOGO_CONTENT_TYPES, LOGO_UPLOAD_EXPIRY_SECONDS, MAX_LOGO_BYTES } from "./logo-helpers";

import type { Action, CurrentActor as CurrentActorModel, Resource } from "../models";

// User avatars live in the assets bucket under a fixed per-user key (namespaced
// under `user/` so it can never collide with an org or project logo key), served
// publicly via the asset CDN. The user.image column is owned by better-auth, so
// the caller persists the returned URL via the auth client — the server only
// manages the stored bytes.
const avatarR2Key = (userId: string): string => `logos/user/${userId}`;

// Resolve the current user's id for an avatar write. Avatars are user-scoped, so
// robot-account actors (no user) can't have one.
const currentUserIdForAvatar = () =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.userId === null) {
      return yield* new NotFound({ message: "No user is associated with this session" });
    }
    return ctx.userId;
  });

// The presigned PUT can't cap its own size or fully constrain its type; enforce
// both against the same rules the logo uploads use, worded for the avatar.
export const avatarRejectionReason = (params: {
  readonly size: number;
  readonly contentType: string | null;
}): string | null => {
  if (params.size > MAX_LOGO_BYTES) {
    return "Avatar must be 2 MB or smaller";
  }
  if (params.contentType !== null && !LOGO_CONTENT_TYPES.has(params.contentType)) {
    return `Unsupported avatar type: ${params.contentType}`;
  }
  return null;
};

const createAvatarUploadUrlEffect = (contentType: string) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const userId = yield* currentUserIdForAvatar();

      const storage = yield* AssetStorage;
      // Build the key server-side — never trust a client-sent key — and sign the
      // content type so the direct upload must declare the same image type.
      const key = avatarR2Key(userId);
      const uploadUrl = yield* storage.createUploadUrl({
        key,
        contentType,
        expiresIn: LOGO_UPLOAD_EXPIRY_SECONDS,
      });
      const uploadExpiresAt = new Date(
        Date.now() + LOGO_UPLOAD_EXPIRY_SECONDS * 1000,
      ).toISOString();

      return {
        key,
        uploadUrl,
        uploadExpiresAt,
        uploadHeaders: createDirectUploadHeaders({ contentType }),
      };
    }),
  );

const setAvatarEffect = () =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const userId = yield* currentUserIdForAvatar();

      const storage = yield* AssetStorage;
      const key = avatarR2Key(userId);
      const stored = yield* storage.headObject({ key });
      if (!stored) {
        return yield* new BadRequest({
          message: "Avatar upload not found; upload the image before finalizing",
        });
      }

      const rejection = avatarRejectionReason({
        size: stored.size,
        contentType: stored.contentType,
      });
      if (rejection !== null) {
        yield* storage.deleteObjects({ keys: [key] });
        return yield* new BadRequest({ message: rejection });
      }

      const env = yield* cloudflareEnv;
      // Cache-bust the public URL by the object's etag: replacing the avatar
      // yields new bytes → new etag → new URL, while the R2 key stays fixed.
      const version = encodeURIComponent(stored.etag ?? crypto.randomUUID());
      const imageUrl = `${env.ASSET_CDN_URL}/${key}?v=${version}`;

      return { imageUrl };
    }),
  );

const removeAvatarEffect = () =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const userId = yield* currentUserIdForAvatar();

      const storage = yield* AssetStorage;
      yield* storage.deleteObjects({ keys: [avatarR2Key(userId)] });

      return { deleted: 1 };
    }),
  );

/**
 * Whether the actor holds an org-scoped token — owner/superadmin are
 * unconditional roots (same bypass order as `assertAccess`), otherwise it
 * mirrors the EXACT org rule the corresponding endpoint gates on, so a UI
 * affordance keyed off this never shows an action the server would 403.
 */
export const actorHolds = (ctx: CurrentActorModel, resource: Resource, action: Action): boolean => {
  if (ctx.isSuperadmin || ctx.isOwner) {
    return true;
  }
  const requirement = ORG_RULES[`${resource}:${action}`];
  return requirement !== undefined && meetsOrgRequirement(ctx.orgRole, requirement);
};

// Org-shared build inputs (credentials/devices/org env vars): show the
// surface to anyone holding developer anywhere — a coarse chrome gate only;
// the endpoints enforce the per-row binding + protected ladders (spec §1a).
const holdsAnywhereDeveloper = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin || ctx.isOwner || meetsAnywhereRequirement(ctx, "developer");

// Robots are project-scoped (spec §1b, v2): the robots surface is for
// admin-tier actors and anyone maintaining at least one project.
const holdsAnywhereMaintainer = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin || ctx.isOwner || meetsAnywhereRequirement(ctx, "maintainer");

export const MeGroupLive = HttpApiBuilder.group(ManagementApi, "me", (handlers) =>
  handlers
    .handle("createAvatarUploadUrl", ({ payload }) =>
      createAvatarUploadUrlEffect(payload.contentType),
    )
    .handle("setAvatar", () => setAvatarEffect())
    .handle("removeAvatar", () => removeAvatarEffect())
    .handle("get", () =>
      Effect.gen(function* () {
        const ctx = yield* CurrentActor;
        const repo = yield* AuthMetaRepo;
        const user = ctx.userId === null ? null : yield* repo.findUserById(ctx.userId);
        const organization = yield* repo.findOrganizationById(ctx.organizationId);
        return {
          user: user ? { id: user.id, name: user.name, email: user.email } : null,
          activeOrganization: organization
            ? {
                id: organization.id,
                name: organization.name,
                slug: organization.slug,
                role: ctx.role,
              }
            : null,
          source: ctx.source,
          actorEmail: ctx.actorEmail,
          orgRole: ctx.orgRole,
          projectRoles: ctx.projectRoles,
          // Sidebar/chrome capability contract. Hiding is UX only —
          // `assertAccess` still guards every endpoint.
          canInviteMembers: actorHolds(ctx, "invitation", "create"),
          canRemoveMembers: actorHolds(ctx, "member", "delete"),
          canManageMembers: actorHolds(ctx, "member", "update"),
          canViewAuditLog: actorHolds(ctx, "auditLog", "read"),
          canViewCredentials: holdsAnywhereDeveloper(ctx),
          canViewDevices: holdsAnywhereDeveloper(ctx),
          canViewVaultAccess: actorHolds(ctx, "vaultAccess", "read"),
          canViewRobots: holdsAnywhereMaintainer(ctx),
          canManageOrgEnvVars: holdsAnywhereDeveloper(ctx),
          canManageOrgSettings: actorHolds(ctx, "organization", "update"),
        };
      }),
    ),
);
