import { Organization } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { AssetStorage } from "../cloudflare/asset-storage";
import { cloudflareEnv } from "../cloudflare/context";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect, toApiCrudEffect } from "../http/to-api-effect";
import { OrganizationRepo } from "../repositories/organizations";
import { LOGO_UPLOAD_EXPIRY_SECONDS, logoRejectionReason } from "./logo-helpers";

import type { OrganizationModel } from "../repositories/organizations";

// Organization logos live in the assets bucket under a fixed per-org key
// (namespaced under `org/` so it can never collide with a project logo key),
// served publicly via the asset CDN.
const logoR2Key = (organizationId: string): string => `logos/org/${organizationId}`;

const toApiOrganization = (org: OrganizationModel) =>
  new Organization({ id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl });

// Load + authorize the active org for a logo write. Shared preamble of the three
// logo handlers; returns the org so callers can echo it back with the new state.
const loadOrgForLogoWrite = () =>
  Effect.gen(function* () {
    yield* assertAccess("organization", "update");
    const ctx = yield* CurrentActor;
    const repo = yield* OrganizationRepo;
    const org = yield* repo.findById({ id: ctx.organizationId });
    if (org === null) {
      return yield* new NotFound({ message: "Organization not found" });
    }
    return org;
  });

const createLogoUploadUrlEffect = (contentType: string) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const org = yield* loadOrgForLogoWrite();

      const storage = yield* AssetStorage;
      // Build the key server-side — never trust a client-sent key — and sign the
      // content type so the direct upload must declare the same image type.
      const key = logoR2Key(org.id);
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

const setLogoEffect = () =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const org = yield* loadOrgForLogoWrite();

      const storage = yield* AssetStorage;
      const key = logoR2Key(org.id);
      const stored = yield* storage.headObject({ key });
      if (!stored) {
        return yield* new BadRequest({
          message: "Logo upload not found; upload the image before finalizing",
        });
      }

      // The presigned PUT can't cap its own size or fully constrain its type;
      // enforce both here and drop a rejected object so it can't be served.
      const rejection = logoRejectionReason({
        size: stored.size,
        contentType: stored.contentType,
      });
      if (rejection !== null) {
        yield* storage.deleteObjects({ keys: [key] });
        return yield* new BadRequest({ message: rejection });
      }

      const env = yield* cloudflareEnv;
      // Cache-bust the public URL by the object's etag: replacing the logo yields
      // new bytes → new etag → new URL, while the R2 key stays fixed (no orphans).
      const version = encodeURIComponent(stored.etag ?? crypto.randomUUID());
      const logoUrl = `${env.ASSET_CDN_URL}/${key}?v=${version}`;
      const repo = yield* OrganizationRepo;
      yield* repo.updateLogoUrl({ id: org.id, logoUrl });

      yield* logAudit({
        action: "organization.logo.update",
        resourceType: "organization",
        resourceId: org.id,
      });

      return toApiOrganization({ ...org, logoUrl });
    }),
  );

const removeLogoEffect = () =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const org = yield* loadOrgForLogoWrite();

      const storage = yield* AssetStorage;
      yield* storage.deleteObjects({ keys: [logoR2Key(org.id)] });
      const repo = yield* OrganizationRepo;
      yield* repo.updateLogoUrl({ id: org.id, logoUrl: null });

      yield* logAudit({
        action: "organization.logo.remove",
        resourceType: "organization",
        resourceId: org.id,
      });

      return toApiOrganization({ ...org, logoUrl: null });
    }),
  );

export const OrganizationGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "organization",
  (handlers) =>
    handlers
      .handle("update", ({ payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            // In-org mutation → the IAM gate is authoritative (owner bypasses; a
            // non-owner needs an explicit organization:update grant). Targets the
            // ACTIVE org only — no id is accepted, so there is no cross-org reach.
            yield* assertAccess("organization", "update");
            const ctx = yield* CurrentActor;
            const repo = yield* OrganizationRepo;
            const updated = yield* repo.update({
              id: ctx.organizationId,
              ...(payload.name === undefined ? {} : { name: payload.name }),
              ...(payload.slug === undefined ? {} : { slug: payload.slug }),
            });
            if (updated === null) {
              return yield* new NotFound({ message: "Organization not found" });
            }
            yield* logAudit({
              action: "organization.update",
              resourceType: "organization",
              resourceId: ctx.organizationId,
            });
            return toApiOrganization(updated);
          }),
        ),
      )
      .handle("createLogoUploadUrl", ({ payload }) =>
        createLogoUploadUrlEffect(payload.contentType),
      )
      .handle("setLogo", () => setLogoEffect())
      .handle("removeLogo", () => removeLogoEffect()),
);
