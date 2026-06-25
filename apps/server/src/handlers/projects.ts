import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { assertAccess } from "../auth/policy";
import { AssetStorage } from "../cloudflare/asset-storage";
import { cloudflareEnv } from "../cloudflare/context";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest } from "../errors";
import { toApiProject } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";
import { ProjectRepo } from "../repositories/projects";

import type { ProjectSortKey, ProjectSortOrder } from "../repositories/projects";

// The three built-in environments. Each new project is seeded one branch + one
// channel per name, flagged built-in so they cannot be renamed or deleted (their
// operational actions stay available). Mirrors the built-in environment entity.
const DEFAULT_ENVIRONMENT_NAMES = ["development", "preview", "production"] as const;

// Project logos live in the assets bucket under a fixed per-project key, served
// publicly via the asset CDN. The presigned PUT expires fast; the upload is a
// quick precursor to the `setLogo` finalize call.
const LOGO_UPLOAD_EXPIRY_SECONDS = 600;

// Hard cap (2 MiB) enforced post-upload (a presigned PUT can't bound its own
// size): the finalize step heads the object and rejects anything larger.
const MAX_LOGO_BYTES = 2_097_152;

const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

const logoR2Key = (projectId: string): string => `logos/${projectId}`;

/**
 * Validate an uploaded logo object's stored metadata against the size cap and the
 * allowed image types. Returns a human-readable rejection reason, or `null` when
 * the object is acceptable. A `null` content type (R2 didn't record one) passes —
 * the presigned PUT already signed an allowed type at request time.
 */
export const logoRejectionReason = (params: {
  readonly size: number;
  readonly contentType: string | null;
}): string | null => {
  if (params.size > MAX_LOGO_BYTES) {
    return "Logo must be 2 MB or smaller";
  }
  if (params.contentType !== null && !LOGO_CONTENT_TYPES.has(params.contentType)) {
    return `Unsupported logo type: ${params.contentType}`;
  }
  return null;
};

// Load + authorize a project for a logo write. Shared preamble of the three logo
// handlers; returns the project so callers can echo it back with the new state.
const loadProjectForLogoWrite = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepo;
    const project = yield* repo.findById({ id });
    yield* assertOrgOwnership(project.organizationId);
    yield* assertAccess("project", "update", { kind: "project", projectId: id });
    return project;
  });

const createLogoUploadUrlEffect = (id: string, contentType: string) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      yield* loadProjectForLogoWrite(id);

      const storage = yield* AssetStorage;
      // Build the key server-side — never trust a client-sent key — and sign the
      // content type so the direct upload must declare the same image type.
      const key = logoR2Key(id);
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

const setLogoEffect = (id: string) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const project = yield* loadProjectForLogoWrite(id);

      const storage = yield* AssetStorage;
      const key = logoR2Key(id);
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
      const repo = yield* ProjectRepo;
      yield* repo.updateLogoUrl({ id, logoUrl });

      yield* logAudit({
        action: "project.logo.update",
        resourceType: "project",
        resourceId: id,
        projectId: id,
      });

      return toApiProject({ ...project, logoUrl });
    }),
  );

const removeLogoEffect = (id: string) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const project = yield* loadProjectForLogoWrite(id);

      const storage = yield* AssetStorage;
      yield* storage.deleteObjects({ keys: [logoR2Key(id)] });
      const repo = yield* ProjectRepo;
      yield* repo.updateLogoUrl({ id, logoUrl: null });

      yield* logAudit({
        action: "project.logo.remove",
        resourceType: "project",
        resourceId: id,
        projectId: id,
      });

      return toApiProject({ ...project, logoUrl: null });
    }),
  );

const parseProjectSort = (
  value: string | undefined = "-lastActivityAt",
): { readonly sort: ProjectSortKey; readonly order: ProjectSortOrder } => {
  const order: ProjectSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "name":
    case "lastActivityAt":
    case "createdAt":
    case "branchCount":
    case "channelCount":
    case "updateCount": {
      return { sort: column, order };
    }
    default: {
      return { sort: "lastActivityAt", order: "desc" };
    }
  }
};

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const branchRepo = yield* BranchRepo;
          const channelRepo = yield* ChannelRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          yield* repo.insert({
            id,
            organizationId: ctx.organizationId,
            name: payload.name,
            slug: payload.slug,
            createdAt: now,
          });

          yield* logAudit({
            action: "project.create",
            resourceType: "project",
            resourceId: id,
            projectId: id,
            metadata: { name: payload.name, slug: payload.slug },
          });

          yield* Effect.forEach(
            DEFAULT_ENVIRONMENT_NAMES,
            (envName) =>
              Effect.gen(function* () {
                const branchId = crypto.randomUUID();
                yield* branchRepo.insert({
                  id: branchId,
                  projectId: id,
                  name: envName,
                  isBuiltin: true,
                  createdAt: now,
                });
                yield* logAudit({
                  action: "branch.create",
                  resourceType: "branch",
                  resourceId: branchId,
                  projectId: id,
                  metadata: { name: envName, projectId: id },
                });

                const channel = yield* channelRepo.insert({
                  projectId: id,
                  name: envName,
                  branchId,
                  isBuiltin: true,
                });
                yield* logAudit({
                  action: "channel.create",
                  resourceType: "channel",
                  resourceId: channel.id,
                  projectId: id,
                  metadata: { name: envName, projectId: id },
                });
              }),
            { concurrency: 1 },
          );

          return toApiProject({
            id,
            organizationId: ctx.organizationId,
            name: payload.name,
            slug: payload.slug,
            createdAt: now,
            lastActivityAt: now,
            archivedAt: null,
            logoUrl: null,
            branchCount: DEFAULT_ENVIRONMENT_NAMES.length,
            channelCount: DEFAULT_ENVIRONMENT_NAMES.length,
            updateCount: 0,
          });
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const { page, limit, offset } = parsePagination(urlParams);

          const { sort, order } = parseProjectSort(urlParams.sort);
          const { items, total } = yield* repo.findByOrg({
            organizationId: ctx.organizationId,
            ...(urlParams.query ? { query: urlParams.query } : {}),
            ...(urlParams.status ? { status: urlParams.status } : {}),
            sort,
            order,
            limit,
            offset,
          });

          return { items: items.map(toApiProject), total, page, limit };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          yield* assertAccess("project", "read", { kind: "project", projectId: path.id });
          return toApiProject(project);
        }),
      ),
    )
    .handle("getBySlug", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const project = yield* repo.findBySlug({
            organizationId: ctx.organizationId,
            slug: path.slug,
          });
          yield* assertAccess("project", "read", { kind: "project", projectId: project.id });
          return toApiProject(project);
        }),
      ),
    )
    .handle("rename", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          yield* assertAccess("project", "update", { kind: "project", projectId: path.id });
          yield* repo.updateName({ id: path.id, name: payload.name });

          yield* logAudit({
            action: "project.rename",
            resourceType: "project",
            resourceId: path.id,
            projectId: path.id,
            metadata: { name: payload.name },
          });

          return toApiProject({ ...project, name: payload.name });
        }),
      ),
    )
    .handle("createLogoUploadUrl", ({ path, payload }) =>
      createLogoUploadUrlEffect(path.id, payload.contentType),
    )
    .handle("setLogo", ({ path }) => setLogoEffect(path.id))
    .handle("removeLogo", ({ path }) => removeLogoEffect(path.id))
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const projectRepo = yield* ProjectRepo;
          const project = yield* projectRepo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          yield* assertAccess("project", "delete", { kind: "project", projectId: path.id });
          yield* projectRepo.delete({ id: path.id });

          yield* logAudit({
            action: "project.delete",
            resourceType: "project",
            resourceId: path.id,
            projectId: path.id,
          });

          return { deleted: 1 };
        }),
      ),
    )
    .handle("archive", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          // `allowArchived` so re-archiving an already-archived project is not
          // self-blocked by the read-only guard; it stays the archive-state gate.
          yield* assertAccess(
            "project",
            "update",
            { kind: "project", projectId: path.id },
            { allowArchived: true },
          );

          // Idempotent: keep the original timestamp if already archived.
          const archivedAt = project.archivedAt ?? new Date().toISOString();
          if (project.archivedAt === null) {
            yield* repo.setArchived({ id: path.id, archivedAt });
            yield* logAudit({
              action: "project.archive",
              resourceType: "project",
              resourceId: path.id,
              projectId: path.id,
            });
          }

          return toApiProject({ ...project, archivedAt });
        }),
      ),
    )
    .handle("unarchive", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          yield* assertAccess(
            "project",
            "update",
            { kind: "project", projectId: path.id },
            { allowArchived: true },
          );

          if (project.archivedAt !== null) {
            yield* repo.setArchived({ id: path.id, archivedAt: null });
            yield* logAudit({
              action: "project.unarchive",
              resourceType: "project",
              resourceId: path.id,
              projectId: path.id,
            });
          }

          return toApiProject({ ...project, archivedAt: null });
        }),
      ),
    ),
);
