import { DESKTOP_ARTIFACT_FORMATS, readDesktopBuildMetadata } from "@better-update/api";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import type {
  CreateDesktopReleaseBody,
  DesktopArtifactFormat,
  UpdateDesktopReleaseBody,
} from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { artifactBlockmapKey, renderBlockmap } from "../domain/desktop-feed-files";
import { BadRequest } from "../errors";
import { toApiDesktopRelease } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { BuildRepo } from "../repositories";
import { DesktopReleaseRepo } from "../repositories/desktop-releases";

import type { BuildWithArtifactModel } from "../models";

const MAX_PAGE = 100;

/** The distribution each desktop platform's releasable builds carry. */
const RELEASABLE_DISTRIBUTION = {
  macos: "developer-id",
  windows: "direct",
  linux: "direct",
} as const;

/** Formats the Tauri updater installs, signed with its minisign key. */
const TAURI_FORMATS: ReadonlySet<string> = new Set<DesktopArtifactFormat>([
  "tar.gz",
  "exe",
  "msi",
  "appimage",
  "deb",
  "rpm",
]);

/** Formats electron-updater downloads differentially from an uploaded blockmap. */
const BLOCKMAP_FORMATS: ReadonlySet<string> = new Set<DesktopArtifactFormat>(["zip", "exe"]);

/**
 * Only a finished desktop build of this project can be released — a macOS
 * Developer ID build, or a Windows / Linux one: the feeds point machines at
 * its stored artifact.
 */
const requireReleasableBuild = (projectId: string, buildId: string) =>
  Effect.gen(function* () {
    const build = yield* (yield* BuildRepo).findById({ id: buildId });
    if (build.projectId !== projectId) {
      return yield* new BadRequest({ message: "The build belongs to another project" });
    }
    const { platform } = build;
    if (
      (platform !== "macos" && platform !== "windows" && platform !== "linux") ||
      build.distribution !== RELEASABLE_DISTRIBUTION[platform]
    ) {
      return yield* new BadRequest({
        message:
          "Only desktop builds (macOS Developer ID, Windows, Linux) can be released to update feeds",
      });
    }
    const formats: readonly string[] = DESKTOP_ARTIFACT_FORMATS[platform];
    if (build.artifact === null || !formats.includes(build.artifact.format)) {
      return yield* new BadRequest({ message: "The build has no uploaded artifact yet" });
    }
    return { ...build, platform, artifact: build.artifact };
  });

/** The signatures a release may carry must suit its platform and format. */
const checkSignatures = (
  build: { readonly platform: string; readonly artifact: { readonly format: string } },
  payload: typeof CreateDesktopReleaseBody.Type,
) => {
  const { format } = build.artifact;
  if (payload.tauriSignature !== undefined && !TAURI_FORMATS.has(format)) {
    return new BadRequest({
      message: `A .${format} build cannot carry a Tauri updater signature (Tauri installs .app.tar.gz, .exe, .msi, .AppImage, .deb and .rpm)`,
    });
  }
  if (payload.sparkleEdSignature !== undefined && build.platform !== "macos") {
    return new BadRequest({ message: "Only a macOS build can carry a Sparkle signature" });
  }
  if (payload.winSparkleEdSignature !== undefined && build.platform !== "windows") {
    return new BadRequest({ message: "Only a Windows build can carry a WinSparkle signature" });
  }
  return undefined;
};

/**
 * Store a `.zip` / `.exe`'s electron-updater blockmap next to its artifact,
 * once it describes exactly that many bytes.
 */
const storeBlockmap = (
  build: BuildWithArtifactModel,
  blockmap: typeof CreateDesktopReleaseBody.Type.electronBlockmap,
) =>
  Effect.gen(function* () {
    if (blockmap === undefined) {
      return false;
    }
    const { artifact } = build;
    if (artifact === null || !BLOCKMAP_FORMATS.has(artifact.format)) {
      return yield* new BadRequest({
        message: "Only a .zip or .exe build can carry an uploaded blockmap",
      });
    }
    const covered = blockmap.sizes.reduce((total, size) => total + size, 0);
    if (blockmap.checksums.length !== blockmap.sizes.length || covered !== artifact.byteSize) {
      return yield* new BadRequest({
        message: `The blockmap covers ${String(covered)} bytes in ${String(blockmap.sizes.length)} chunks with ${String(blockmap.checksums.length)} checksums; the artifact has ${String(artifact.byteSize)} bytes`,
      });
    }
    yield* (yield* BuildRuntime).putObject({
      key: artifactBlockmapKey(artifact.r2Key),
      body: new TextEncoder().encode(renderBlockmap(blockmap)),
      contentType: "application/json",
    });
    return true;
  });

const handleCreate = ({
  params,
  payload,
}: {
  readonly params: { readonly projectId: string };
  readonly payload: typeof CreateDesktopReleaseBody.Type;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      yield* assertProjectOwnership(params.projectId);
      yield* assertAccess("build", "create", { kind: "build", projectId: params.projectId });
      const build = yield* requireReleasableBuild(params.projectId, payload.buildId);
      const signatureError = checkSignatures(build, payload);
      if (signatureError !== undefined) {
        return yield* signatureError;
      }
      const blockmap =
        (yield* storeBlockmap(build, payload.electronBlockmap)) ||
        // An AppImage carries its blockmap inside; the build recorded its size.
        (build.platform === "linux" &&
          build.artifact.format === "appimage" &&
          readDesktopBuildMetadata("linux", build.metadataJson)?.blockMapSize !== undefined);
      const repo = yield* DesktopReleaseRepo;
      const now = new Date().toISOString();
      const existing = yield* repo.findByBuildAndChannel({
        buildId: payload.buildId,
        channel: payload.channel,
      });
      const id = existing?.id ?? crypto.randomUUID();
      // Re-releasing replaces the content and resumes a halted release.
      yield* existing === null
        ? repo.insert({
            id,
            projectId: params.projectId,
            buildId: payload.buildId,
            channel: payload.channel,
            releaseNotes: toDbNull(payload.releaseNotes),
            critical: payload.critical ?? false,
            rolloutPercentage: payload.rolloutPercentage ?? 100,
            phasedRolloutHours: toDbNull(payload.phasedRolloutHours),
            sha512: payload.sha512,
            sparkleEdSignature: toDbNull(payload.sparkleEdSignature),
            winSparkleEdSignature: toDbNull(payload.winSparkleEdSignature),
            tauriSignature: toDbNull(payload.tauriSignature),
            blockmap,
            now,
          })
        : repo.update({
            id,
            halted: false,
            releaseNotes: toDbNull(payload.releaseNotes),
            critical: payload.critical ?? false,
            rolloutPercentage: payload.rolloutPercentage ?? 100,
            phasedRolloutHours: toDbNull(payload.phasedRolloutHours),
            sha512: payload.sha512,
            sparkleEdSignature: toDbNull(payload.sparkleEdSignature),
            winSparkleEdSignature: toDbNull(payload.winSparkleEdSignature),
            tauriSignature: toDbNull(payload.tauriSignature),
            blockmap,
            now,
          });
      yield* logAudit({
        action: "build.release",
        resourceType: "build",
        resourceId: payload.buildId,
        projectId: params.projectId,
        metadata: {
          releaseId: id,
          channel: payload.channel,
          rolloutPercentage: payload.rolloutPercentage ?? 100,
        },
      });
      return toApiDesktopRelease(yield* repo.findById({ id }));
    }),
  );

const handleUpdate = ({
  params,
  payload,
}: {
  readonly params: { readonly id: string };
  readonly payload: typeof UpdateDesktopReleaseBody.Type;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      const repo = yield* DesktopReleaseRepo;
      const release = yield* repo.findById({ id: params.id });
      yield* assertProjectOwnership(release.projectId);
      yield* assertAccess("build", "create", {
        kind: "build",
        projectId: release.projectId,
        buildId: release.buildId,
      });
      yield* repo.update({ id: params.id, now: new Date().toISOString(), ...payload });
      yield* logAudit({
        action: "build.release.update",
        resourceType: "build",
        resourceId: release.buildId,
        projectId: release.projectId,
        metadata: { releaseId: params.id, ...compact(payload) },
      });
      return toApiDesktopRelease(yield* repo.findById({ id: params.id }));
    }),
  );

export const DesktopReleasesGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "desktopReleases",
  (handlers) =>
    handlers
      .handle("list", ({ params, query }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(params.projectId);
            yield* assertAccess("build", "read", { kind: "build", projectId: params.projectId });
            const repo = yield* DesktopReleaseRepo;
            const { page, limit: requested } = parsePagination(query);
            // One release per build and channel: a page of 100 is every release
            // a project could reasonably hold; more is a client asking for all.
            const limit = Math.min(requested, MAX_PAGE);
            const offset = (page - 1) * limit;
            const { items, total } = yield* repo.listByProject({
              projectId: params.projectId,
              platform: query.platform,
              channel: query.channel,
              buildId: query.buildId,
              limit,
              offset,
            });
            return { items: items.map(toApiDesktopRelease), total, page, limit };
          }),
        ),
      )
      .handle("create", handleCreate)
      .handle("get", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const release = yield* (yield* DesktopReleaseRepo).findById({ id: params.id });
            yield* assertProjectOwnership(release.projectId);
            yield* assertAccess("build", "read", {
              kind: "build",
              projectId: release.projectId,
              buildId: release.buildId,
            });
            return toApiDesktopRelease(release);
          }),
        ),
      )
      .handle("update", handleUpdate)
      .handle("delete", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* DesktopReleaseRepo;
            const release = yield* repo.findById({ id: params.id });
            yield* assertProjectOwnership(release.projectId);
            yield* assertAccess("build", "delete", {
              kind: "build",
              projectId: release.projectId,
              buildId: release.buildId,
            });
            yield* repo.delete({ id: params.id });
            yield* logAudit({
              action: "build.release.delete",
              resourceType: "build",
              resourceId: release.buildId,
              projectId: release.projectId,
              metadata: { releaseId: params.id, channel: release.channel },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
