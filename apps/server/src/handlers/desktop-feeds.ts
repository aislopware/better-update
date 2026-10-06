/**
 * Public macOS update feeds — unauthenticated like the Expo manifest, because
 * an installed app polls them anonymously. They expose only what a project
 * explicitly released (`desktop_releases`), never its other builds.
 *
 *   GET /feeds/:projectId/macos/appcast.xml[?installId=…]   Sparkle 2
 *   GET /feeds/:projectId/macos/:channel-mac.yml            electron-updater
 *   GET /feeds/:projectId/macos/:channel-tauri.json[?arch=…] Tauri updater
 *   GET /feeds/:projectId/macos/download/:releaseId/:file   302 → signed R2 URL
 *   GET /feeds/:projectId/macos/download/:releaseId/:file.blockmap   electron-updater blockmap
 *
 * A download with a `Range` header is answered by the Worker itself — 206,
 * `multipart/byteranges` for several ranges — because electron-updater's
 * differential download asks for many ranges at once, which a presigned R2
 * URL cannot serve.
 *
 * Percentage rollout for Sparkle and Tauri is server-side: a release below
 * 100 % is listed only for an install id (the `installId` query parameter —
 * Sparkle's `feedParameters` — or an `X-Install-Id` header) hashing into its
 * bucket, with the same hash the OTA manifest uses; a request without one sees
 * fully rolled-out releases only. Sparkle's own time-based phasing
 * (`phasedRolloutHours`) needs no id. electron-updater does its own staging
 * from `stagingPercentage`.
 */
import { Effect } from "effect";

import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { CryptoService } from "../domain/crypto-service";
import {
  artifactBlockmapKey,
  blockmapVersionOf,
  ELECTRON_FEED_FILE,
  feedFileName,
  isTauriArch,
  pickElectronRelease,
  renderAppcast,
  renderElectronYml,
  renderTauriDynamic,
  renderTauriStatic,
  TAURI_FEED_FILE,
} from "../domain/desktop-feeds";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import {
  contentRange,
  multipartByteRanges,
  parseRangeHeader,
  planObjectReads,
} from "../lib/http-range";
import { DesktopReleaseRepo } from "../repositories/desktop-releases";

import type { DesktopFeedEntry } from "../desktop-release-models";
import type { ServerInfrastructure } from "../infrastructure-layer";

const FEED_ROUTE = /^\/feeds\/(?<projectId>[^/]+)\/macos\/(?<rest>.+)$/u;
const DOWNLOAD_ROUTE = /^download\/(?<releaseId>[^/]+)\/(?<file>[^/]+)$/u;
const BLOCKMAP_SUFFIX = ".blockmap";
/** Older releases of one version considered for its blockmap. */
const BLOCKMAP_CANDIDATES = 10;

/** Releases an appcast lists; older ones are what a held-back client falls back to. */
const APPCAST_LIMIT = 25;

const runFeedEffect = async <Success>(
  effect: Effect.Effect<Success, never, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const notFound = () => Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });

const inRollout = (entry: DesktopFeedEntry, installId: string | null) =>
  Effect.gen(function* () {
    if (entry.rolloutPercentage === 100) {
      return true;
    }
    if (installId === null || installId === "") {
      return false;
    }
    const crypto = yield* CryptoService;
    const fraction = yield* crypto
      .sha256Fraction(entry.id, installId)
      .pipe(Effect.orElseSucceed(() => 1));
    return fraction < entry.rolloutPercentage / 100;
  });

/** The install id a client bucketed itself with, from the query or a header. */
const installIdOf = (request: Request, url: URL): string | null =>
  url.searchParams.get("installId") ?? request.headers.get("x-install-id");

// Per-install answers must not be shared; the bare feed may be.
const feedCacheControl = (installId: string | null) =>
  installId === null ? "public, max-age=60" : "private, max-age=60";

/** The live releases this install may see, newest first. */
const visibleReleases = (
  projectId: string,
  channel: string | undefined,
  installId: string | null,
) =>
  Effect.gen(function* () {
    const repo = yield* DesktopReleaseRepo;
    const entries = yield* repo.listFeed({ projectId, channel, limit: APPCAST_LIMIT });
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.filter(array, predicate) is not Array.prototype.filter
    return yield* Effect.filter(entries, (entry) => inRollout(entry, installId));
  });

const serveAppcast = (projectId: string, url: URL, installId: string | null) =>
  Effect.gen(function* () {
    const body = renderAppcast({
      title: "Updates",
      feedBaseUrl: `${url.origin}/feeds/${projectId}/macos/`,
      entries: yield* visibleReleases(projectId, undefined, installId),
    });
    return new Response(body, {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": feedCacheControl(installId),
      },
    });
  });

/**
 * The static form for a fixed endpoint; the dynamic one when the endpoint
 * passes `arch={{arch}}`. 204 is Tauri's "no update".
 */
const serveTauriJson = (projectId: string, channel: string, url: URL, installId: string | null) =>
  Effect.gen(function* () {
    const arch = url.searchParams.get("arch");
    if (arch !== null && !isTauriArch(arch)) {
      return Response.json(
        { code: "BAD_REQUEST", message: "arch must be aarch64 or x86_64" },
        { status: 400 },
      );
    }
    const entries = yield* visibleReleases(projectId, channel, installId);
    const feedBaseUrl = `${url.origin}/feeds/${projectId}/macos/`;
    const body =
      arch === null
        ? renderTauriStatic(entries, feedBaseUrl)
        : renderTauriDynamic(entries, arch, feedBaseUrl);
    return body === undefined
      ? new Response(null, {
          status: 204,
          headers: { "cache-control": feedCacheControl(installId) },
        })
      : new Response(body, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": feedCacheControl(installId),
          },
        });
  });

const serveElectronYml = (projectId: string, channel: string) =>
  Effect.gen(function* () {
    const repo = yield* DesktopReleaseRepo;
    const picked = pickElectronRelease(
      yield* repo.listFeed({ projectId, channel, limit: APPCAST_LIMIT }),
    );
    if (picked === undefined) {
      return notFound();
    }
    return new Response(renderElectronYml(picked), {
      headers: {
        "content-type": "text/yaml; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  });

const OCTET_STREAM = "application/octet-stream";

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

const serveDownload = (projectId: string, releaseId: string, range: string | null) =>
  Effect.gen(function* () {
    const entry = yield* (yield* DesktopReleaseRepo).findFeedEntry({ projectId, id: releaseId });
    if (entry === null) {
      return notFound();
    }
    const ranged = range === null ? undefined : yield* serveRanges(entry, range);
    if (ranged !== undefined) {
      return ranged;
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
 * zip of that version with the same file name, preferring `entry`'s channel.
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
      appVersion,
      limit: BLOCKMAP_CANDIDATES,
    })).filter((candidate) => feedFileName(candidate) === fileName);
    return candidates.find((candidate) => candidate.channel === entry.channel) ?? candidates.at(0);
  });

/** Gzipped, as electron-updater reads it. */
const serveBlockmap = (projectId: string, releaseId: string, fileName: string) =>
  Effect.gen(function* () {
    const entry = yield* (yield* DesktopReleaseRepo).findFeedEntry({ projectId, id: releaseId });
    const release =
      entry?.artifactFormat === "zip" ? yield* blockmapRelease(entry, fileName) : undefined;
    if (release === undefined || !release.blockmap) {
      return notFound();
    }
    const blob = yield* (yield* BuildRuntime).getObject({
      key: artifactBlockmapKey(release.r2Key),
    });
    return blob?.body
      ? new Response(blob.body.pipeThrough(new CompressionStream("gzip")), {
          headers: { "content-type": OCTET_STREAM, "cache-control": "public, max-age=300" },
        })
      : notFound();
  });

/** An artifact, or its blockmap; a `Range` header counts on GET only. */
const downloadEffect = (request: Request, projectId: string, rest: string) => {
  const download = DOWNLOAD_ROUTE.exec(rest)?.groups;
  const releaseId = download?.["releaseId"];
  const file = download?.["file"];
  if (releaseId === undefined || file === undefined) {
    return undefined;
  }
  return file.endsWith(BLOCKMAP_SUFFIX)
    ? serveBlockmap(projectId, releaseId, file.slice(0, -BLOCKMAP_SUFFIX.length))
    : serveDownload(
        projectId,
        releaseId,
        request.method === "GET" ? request.headers.get("range") : null,
      );
};

/** Route a `/feeds/…` request, or `null` when the path is not a feed. */
export const matchDesktopFeedRoute = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> => {
  const match = FEED_ROUTE.exec(url.pathname);
  const projectId = match?.groups?.["projectId"];
  const rest = match?.groups?.["rest"];
  if (projectId === undefined || rest === undefined) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { code: "METHOD_NOT_ALLOWED", message: "Feeds are read-only" },
      { status: 405 },
    );
  }
  const installId = installIdOf(request, url);
  if (rest === "appcast.xml") {
    return runFeedEffect(serveAppcast(projectId, url, installId), env);
  }
  const channel = ELECTRON_FEED_FILE.exec(rest)?.groups?.["channel"];
  if (channel !== undefined) {
    return runFeedEffect(serveElectronYml(projectId, channel), env);
  }
  const tauriChannel = TAURI_FEED_FILE.exec(rest)?.groups?.["channel"];
  if (tauriChannel !== undefined) {
    return runFeedEffect(serveTauriJson(projectId, tauriChannel, url, installId), env);
  }
  const download = downloadEffect(request, projectId, rest);
  return download === undefined ? notFound() : runFeedEffect(download, env);
};
