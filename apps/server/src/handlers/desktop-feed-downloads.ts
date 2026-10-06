/**
 * Downloads behind the public desktop feeds: an artifact (302 to a presigned
 * R2 URL, or ranged bytes), its electron-updater blockmap, and a Sparkle
 * delta (302).
 *
 * A download with a `Range` header is answered by the Worker itself — 206,
 * `multipart/byteranges` for several ranges — because electron-updater's
 * differential download asks for many ranges at once, which a presigned R2
 * URL cannot serve.
 */
import { Effect } from "effect";

import type { DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

import { BuildRuntime } from "../cloudflare/build-runtime";
import { DesktopAnalytics } from "../domain/desktop-analytics";
import { artifactBlockmapKey, blockmapVersionOf, feedFileName } from "../domain/desktop-feed-files";
import {
  contentRange,
  multipartByteRanges,
  parseRangeHeader,
  planObjectReads,
} from "../lib/http-range";
import { DesktopBuildDeltaRepo } from "../repositories/desktop-build-deltas";
import { DesktopReleaseRepo } from "../repositories/desktop-releases";

import type { DesktopFeedEntry } from "../desktop-release-models";
import type { DesktopTransfer } from "../domain/desktop-analytics";

const DOWNLOAD_ROUTE = /^download\/(?<releaseId>[^/]+)\/(?<file>[^/]+)$/u;
const DELTA_ROUTE = /^delta\/(?<releaseId>[^/]+)\/(?<deltaId>[^/]+)\/(?<file>[^/]+\.delta)$/u;
const BLOCKMAP_SUFFIX = ".blockmap";
/** Older releases of one version considered for its blockmap. */
const BLOCKMAP_CANDIDATES = 10;

const notFound = () => Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });

const OCTET_STREAM = "application/octet-stream";

const recordDownload = (entry: DesktopFeedEntry, transfer: DesktopTransfer, bytes: number) =>
  Effect.gen(function* () {
    yield* (yield* DesktopAnalytics).recordDownload({
      projectId: entry.projectId,
      platform: entry.platform,
      releaseId: entry.id,
      version: entry.appVersion,
      format: entry.artifactFormat,
      transfer,
      bytes,
    });
  });

/** One range straight from R2; several as `multipart/byteranges`. */
const serveRanges = (entry: DesktopFeedEntry, header: string) =>
  Effect.gen(function* () {
    const size = entry.byteSize;
    const request = parseRangeHeader(header, size);
    if (request.kind === "ignore") {
      return undefined;
    }
    if (request.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${String(size)}` },
      });
    }
    const runtime = yield* BuildRuntime;
    const common = { "accept-ranges": "bytes", "cache-control": "no-store" };
    yield* recordDownload(
      entry,
      "range",
      request.ranges.reduce((total, range) => total + range.length, 0),
    );
    const [first, ...rest] = request.ranges;
    if (rest.length === 0) {
      const blob = yield* runtime.getObjectRange({ key: entry.r2Key, range: first });
      return blob?.body
        ? new Response(blob.body, {
            status: 206,
            headers: {
              ...common,
              "content-type": OCTET_STREAM,
              "content-length": String(first.length),
              "content-range": contentRange(first, size),
            },
          })
        : notFound();
    }
    const boundary = crypto.randomUUID();
    const framed = multipartByteRanges({
      ranges: request.ranges,
      size,
      boundary,
      contentType: OCTET_STREAM,
    });
    const body = yield* runtime.streamObjectReads({
      key: entry.r2Key,
      reads: planObjectReads(framed),
    });
    return new Response(body, {
      status: 206,
      headers: { ...common, "content-type": `multipart/byteranges; boundary=${boundary}` },
    });
  });

const serveDownload = (
  projectId: string,
  platform: DesktopPlatform,
  releaseId: string,
  request: { readonly method: string; readonly range: string | null },
) =>
  Effect.gen(function* () {
    const entry = yield* (yield* DesktopReleaseRepo).findFeedEntry({
      projectId,
      platform,
      id: releaseId,
    });
    if (entry === null) {
      return notFound();
    }
    const { range } = request;
    const ranged = range === null ? undefined : yield* serveRanges(entry, range);
    if (ranged !== undefined) {
      return ranged;
    }
    // A HEAD probes; only a GET downloads.
    if (request.method === "GET") {
      yield* recordDownload(entry, "full", entry.byteSize);
    }
    const runtime = yield* BuildRuntime;
    const location = yield* runtime.createDownloadUrl({
      key: entry.r2Key,
      expiresIn: 900,
      contentDisposition: `attachment; filename="${feedFileName(entry)}"`,
    });
    return new Response(null, {
      status: 302,
      headers: { location, "accept-ranges": "bytes", "cache-control": "no-store" },
    });
  });

/**
 * The release whose blockmap `<fileName>.blockmap` under `entry` names: the
 * entry's own, or — the updater's guess for the version it runs — the newest
 * release of that version in the same format with the same file name,
 * preferring `entry`'s channel.
 */
const blockmapRelease = (entry: DesktopFeedEntry, fileName: string) =>
  Effect.gen(function* () {
    if (feedFileName(entry) === fileName) {
      return entry;
    }
    const appVersion = blockmapVersionOf(entry, fileName);
    if (appVersion === undefined) {
      return undefined;
    }
    const candidates = (yield* (yield* DesktopReleaseRepo).listBlockmapReleases({
      projectId: entry.projectId,
      platform: entry.platform,
      format: entry.artifactFormat,
      appVersion,
      limit: BLOCKMAP_CANDIDATES,
    })).filter((candidate) => feedFileName(candidate) === fileName);
    return candidates.find((candidate) => candidate.channel === entry.channel) ?? candidates.at(0);
  });

/** Formats whose blockmap is a stored sidecar (an AppImage embeds its own). */
const SIDECAR_BLOCKMAP_FORMATS: ReadonlySet<string> = new Set<DesktopArtifactFormat>([
  "zip",
  "exe",
]);

/** Gzipped, as electron-updater reads it. */
const serveBlockmap = (
  projectId: string,
  platform: DesktopPlatform,
  releaseId: string,
  fileName: string,
) =>
  Effect.gen(function* () {
    const entry = yield* (yield* DesktopReleaseRepo).findFeedEntry({
      projectId,
      platform,
      id: releaseId,
    });
    const release =
      entry !== null && SIDECAR_BLOCKMAP_FORMATS.has(entry.artifactFormat)
        ? yield* blockmapRelease(entry, fileName)
        : undefined;
    if (release === undefined || !release.blockmap) {
      return notFound();
    }
    const blob = yield* (yield* BuildRuntime).getObject({
      key: artifactBlockmapKey(release.r2Key),
    });
    if (blob?.body && entry !== null) {
      yield* recordDownload(entry, "blockmap", blob.size);
    }
    return blob?.body
      ? new Response(blob.body.pipeThrough(new CompressionStream("gzip")), {
          headers: { "content-type": OCTET_STREAM, "cache-control": "public, max-age=300" },
        })
      : notFound();
  });

/** A Sparkle delta the live release's appcast item lists: a 302 to it in R2. */
const serveDelta = (
  projectId: string,
  route: { readonly releaseId: string; readonly deltaId: string; readonly file: string },
  request: { readonly method: string },
) =>
  Effect.gen(function* () {
    const entry = yield* (yield* DesktopReleaseRepo).findFeedEntry({
      projectId,
      platform: "macos",
      id: route.releaseId,
    });
    const delta = yield* (yield* DesktopBuildDeltaRepo).findById({ id: route.deltaId });
    if (entry === null || delta === null || delta.buildId !== entry.buildId) {
      return notFound();
    }
    if (request.method === "GET") {
      yield* recordDownload(entry, "delta", delta.byteSize);
    }
    const location = yield* (yield* BuildRuntime).createDownloadUrl({
      key: delta.r2Key,
      expiresIn: 900,
      contentDisposition: `attachment; filename="${route.file}"`,
    });
    return new Response(null, {
      status: 302,
      headers: { location, "cache-control": "no-store" },
    });
  });

/** An artifact, its blockmap, or a delta; a `Range` header counts on GET only. */
export const downloadEffect = (
  request: Request,
  projectId: string,
  platform: DesktopPlatform,
  rest: string,
) => {
  const delta = DELTA_ROUTE.exec(rest)?.groups;
  const deltaRelease = delta?.["releaseId"];
  const deltaId = delta?.["deltaId"];
  const deltaFile = delta?.["file"];
  if (
    platform === "macos" &&
    deltaRelease !== undefined &&
    deltaId !== undefined &&
    deltaFile !== undefined
  ) {
    return serveDelta(
      projectId,
      { releaseId: deltaRelease, deltaId, file: deltaFile },
      { method: request.method },
    );
  }
  const download = DOWNLOAD_ROUTE.exec(rest)?.groups;
  const releaseId = download?.["releaseId"];
  const file = download?.["file"];
  if (releaseId === undefined || file === undefined) {
    return undefined;
  }
  return file.endsWith(BLOCKMAP_SUFFIX)
    ? serveBlockmap(projectId, platform, releaseId, file.slice(0, -BLOCKMAP_SUFFIX.length))
    : serveDownload(projectId, platform, releaseId, {
        method: request.method,
        range: request.method === "GET" ? request.headers.get("range") : null,
      });
};
