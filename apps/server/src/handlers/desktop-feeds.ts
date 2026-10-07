/**
 * Public desktop update feeds — unauthenticated like the Expo manifest,
 * because an installed app polls them anonymously. They expose only what a
 * project explicitly released (`desktop_releases`), never its other builds.
 *
 *   GET /feeds/:projectId/macos/appcast.xml[?installId=…]          Sparkle 2
 *   GET /feeds/:projectId/macos/:channel-mac.yml                   electron-updater
 *   GET /feeds/:projectId/windows/:channel.yml                     electron-updater (NSIS)
 *   GET /feeds/:projectId/windows/appcast.xml[?channel=&installId=] WinSparkle
 *   GET /feeds/:projectId/linux/:channel-linux[-arm64|-arm|-ia32].yml electron-updater
 *   GET /feeds/:projectId/:platform/:channel-tauri.json[?arch=&bundle_type=] Tauri updater
 *   GET /feeds/:projectId/tauri/:channel.json[?target=&arch=&bundle_type=]   Tauri, every OS
 *   GET /feeds/:projectId/:platform/download/:releaseId/:file[.blockmap]
 *   GET /feeds/:projectId/:platform/latest/download[?format=&arch=&channel=] first install
 *   GET /feeds/:projectId/releases.json[?channel=]                 download page index
 *   GET /feeds/:projectId/linux/apt/…                              APT repository (`apt-repository.ts`)
 *
 * Downloads (ranges, blockmaps) are served by `desktop-feed-downloads.ts`.
 *
 * Percentage rollout for Sparkle, WinSparkle and Tauri is server-side: a
 * release below 100 % is listed only for an install id (the `installId` query
 * parameter — Sparkle's `feedParameters` — or an `X-Install-Id` header)
 * hashing into its bucket, with the same hash the OTA manifest uses; a request
 * without one sees fully rolled-out releases only. Sparkle's own time-based
 * phasing (`phasedRolloutHours`) needs no id. electron-updater does its own
 * staging from `stagingPercentage`.
 */
import {
  DEFAULT_DESKTOP_CHANNEL,
  DESKTOP_ARTIFACT_FORMATS,
  isDesktopArtifactFormat,
  isDesktopPlatform,
} from "@better-update/api";
import { Effect } from "effect";

import type { DesktopPlatform } from "@better-update/api";

import { provideCloudflareEnv } from "../cloudflare/context";
import { CryptoService } from "../domain/crypto-service";
import { DesktopAnalytics } from "../domain/desktop-analytics";
import { desktopClientVersion } from "../domain/desktop-client-version";
import { feedDeltaPath, feedDownloadPath } from "../domain/desktop-feed-files";
import { renderAppcast, renderWinSparkleAppcast } from "../domain/desktop-feeds-appcast";
import {
  parseElectronFeedFile,
  pickElectronRelease,
  renderElectronYml,
} from "../domain/desktop-feeds-electron";
import {
  isTauriArch,
  renderTauriDynamic,
  renderTauriStatic,
  TAURI_CHANNEL_FILE,
  TAURI_FEED_FILE,
  tauriTargetPlatform,
} from "../domain/desktop-feeds-tauri";
import {
  archFromAlias,
  FIRST_INSTALL_FORMATS,
  pickLatestDownload,
  renderReleaseIndex,
} from "../domain/desktop-release-index";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { toOptional } from "../lib/nullable";
import { DesktopBuildDeltaRepo } from "../repositories/desktop-build-deltas";
import { DesktopReleaseRepo } from "../repositories/desktop-releases";
import { aptEffect } from "./apt-repository";
import { downloadEffect } from "./desktop-feed-downloads";

import type { DesktopFeedEntry } from "../desktop-release-models";
import type { DesktopCheckEvent } from "../domain/desktop-analytics";
import type { DeltaUrl, DownloadUrl } from "../domain/desktop-feed-files";
import type { TauriArch } from "../domain/desktop-feeds-tauri";
import type { ServerInfrastructure } from "../infrastructure-layer";

const FEED_ROUTE =
  /^\/feeds\/(?<projectId>[^/]+)\/(?<scope>macos|windows|linux|tauri)\/(?<rest>.+)$/u;
const INDEX_ROUTE = /^\/feeds\/(?<projectId>[^/]+)\/releases\.json$/u;
const CHANNEL = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
/** Releases a feed considers; older ones are what a held-back client falls back to. */
const FEED_LIMIT = 25;

const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = ["macos", "windows", "linux"];
/** The Linux feed directory's APT repository. */
const APT_PREFIX = "apt/";

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

const badRequest = (message: string) =>
  Response.json({ code: "BAD_REQUEST", message }, { status: 400 });

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

/** Who is asking a feed: what rollout bucketing and telemetry need from the request. */
interface FeedClient {
  readonly installId: string | null;
  readonly clientVersion: string | undefined;
  /** Only a GET is a check; a HEAD is a probe. */
  readonly counted: boolean;
}

const feedClientOf = (request: Request, url: URL): FeedClient => ({
  installId: installIdOf(request, url),
  clientVersion: desktopClientVersion({
    userAgent: request.headers.get("user-agent"),
    query: url.searchParams,
  }),
  counted: request.method === "GET",
});

const servedOf = (entry: DesktopFeedEntry | undefined) =>
  entry === undefined ? undefined : { releaseId: entry.id, version: entry.appVersion };

/** One feed check, best-effort (see `DesktopAnalytics`). */
const recordCheck = (
  client: FeedClient,
  event: Omit<DesktopCheckEvent, "installId" | "clientVersion">,
) =>
  client.counted
    ? Effect.gen(function* () {
        yield* (yield* DesktopAnalytics).recordCheck({
          ...event,
          installId: client.installId,
          clientVersion: client.clientVersion,
        });
      })
    : Effect.void;

// Per-install answers must not be shared; the bare feed may be.
const feedCacheControl = (installId: string | null) =>
  installId === null ? "public, max-age=60" : "private, max-age=60";

/** Absolute download URLs, each under its own platform's feed directory. */
const downloadUrlFor =
  (origin: string, projectId: string): DownloadUrl =>
  (entry) =>
    `${origin}/feeds/${projectId}/${entry.platform}/${feedDownloadPath(entry)}`;

const listFeed = (projectId: string, platform: DesktopPlatform, channel: string | undefined) =>
  Effect.gen(function* () {
    const repo = yield* DesktopReleaseRepo;
    return yield* repo.listFeed({ projectId, platform, channel, limit: FEED_LIMIT });
  });

/** The live releases this install may see, newest first. */
const visibleReleases = (
  projectId: string,
  platform: DesktopPlatform,
  channel: string | undefined,
  installId: string | null,
) =>
  Effect.gen(function* () {
    const entries = yield* listFeed(projectId, platform, channel);
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.filter(array, predicate) is not Array.prototype.filter
    return yield* Effect.filter(entries, (entry) => inRollout(entry, installId));
  });

const xmlResponse = (body: string, installId: string | null) =>
  new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": feedCacheControl(installId),
    },
  });

/** A channel named by a query parameter, the default one when absent. */
const queryChannel = (url: URL): string | undefined => {
  const channel = url.searchParams.get("channel") ?? DEFAULT_DESKTOP_CHANNEL;
  return CHANNEL.test(channel) ? channel : undefined;
};

/** Sparkle's appcast tags channels per item; WinSparkle has none, so its URL picks one. */
const serveAppcast = (projectId: string, platform: DesktopPlatform, url: URL, client: FeedClient) =>
  Effect.gen(function* () {
    const { installId } = client;
    const downloadUrl = downloadUrlFor(url.origin, projectId);
    if (platform === "macos") {
      const entries = yield* visibleReleases(projectId, platform, undefined, installId);
      // One appcast carries every channel; the check counts against all of them.
      yield* recordCheck(client, {
        projectId,
        platform,
        updater: "sparkle",
        channel: "*",
        arch: undefined,
        served: servedOf(entries[0]),
      });
      const deltas = yield* (yield* DesktopBuildDeltaRepo).listByBuilds({
        buildIds: entries.map((entry) => entry.buildId),
      });
      const byBuild = Map.groupBy(deltas, (delta) => delta.buildId);
      const deltaUrl: DeltaUrl = (entry, delta) =>
        `${url.origin}/feeds/${projectId}/macos/${feedDeltaPath(entry, delta)}`;
      const appcast = renderAppcast({
        title: "Updates",
        downloadUrl,
        entries,
        deltas: { byBuild, url: deltaUrl },
      });
      return xmlResponse(appcast, installId);
    }
    const channel = queryChannel(url);
    if (platform !== "windows" || channel === undefined) {
      return platform === "windows" ? badRequest("Invalid channel") : notFound();
    }
    const entries = yield* visibleReleases(projectId, platform, channel, installId);
    yield* recordCheck(client, {
      projectId,
      platform,
      updater: "winsparkle",
      channel,
      arch: undefined,
      served: servedOf(entries[0]),
    });
    return xmlResponse(
      renderWinSparkleAppcast({ title: "Updates", downloadUrl, entries }),
      installId,
    );
  });

const tauriResponse = (body: string | undefined, installId: string | null) =>
  body === undefined
    ? new Response(null, { status: 204, headers: { "cache-control": feedCacheControl(installId) } })
    : new Response(body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": feedCacheControl(installId),
        },
      });

/** `{{arch}}` and `{{bundle_type}}` from the query, when the endpoint is templated with them. */
const tauriRequest = (url: URL): { readonly arch: TauriArch | null } | string => {
  const arch = url.searchParams.get("arch");
  return arch !== null && !isTauriArch(arch)
    ? "arch must be x86_64, aarch64, i686 or armv7"
    : { arch };
};

/**
 * One platform's Tauri JSON: the static form for a fixed endpoint, the
 * dynamic one when the endpoint passes `arch={{arch}}` (and optionally
 * `bundle_type={{bundle_type}}`). 204 is Tauri's "no update".
 */
const serveTauriJson = (
  projectId: string,
  platforms: readonly DesktopPlatform[],
  channel: string,
  url: URL,
  client: FeedClient,
) =>
  Effect.gen(function* () {
    const { installId } = client;
    const parsed = tauriRequest(url);
    if (typeof parsed === "string") {
      return badRequest(parsed);
    }
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, f) is not Array.prototype.forEach
    const lists = yield* Effect.forEach(platforms, (platform) =>
      visibleReleases(projectId, platform, channel, installId),
    );
    // Newest first across platforms, as one feed.
    const entries = lists
      .flat()
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
    const downloadUrl = downloadUrlFor(url.origin, projectId);
    const body =
      parsed.arch === null
        ? renderTauriStatic(entries, downloadUrl)
        : renderTauriDynamic(
            entries,
            { arch: parsed.arch, bundleType: toOptional(url.searchParams.get("bundle_type")) },
            downloadUrl,
          );
    const served = body === undefined ? undefined : entries.find((entry) => entry.tauriSignature);
    const [onlyPlatform] = platforms;
    const platform = platforms.length === 1 ? onlyPlatform : served?.platform;
    if (platform !== undefined) {
      yield* recordCheck(client, {
        projectId,
        platform,
        updater: "tauri",
        channel,
        arch: toOptional(parsed.arch),
        served: servedOf(served),
      });
    }
    return tauriResponse(body, installId);
  });

/** The cross-platform Tauri feed: `?target={{target}}` narrows it to one OS. */
const serveTauriChannel = (projectId: string, channel: string, url: URL, client: FeedClient) => {
  const target = url.searchParams.get("target");
  const platform = tauriTargetPlatform(target);
  if (target !== null && platform === undefined) {
    return Effect.succeed(badRequest("target must be darwin, windows or linux"));
  }
  return serveTauriJson(
    projectId,
    platform === undefined ? DESKTOP_PLATFORMS : [platform],
    channel,
    url,
    client,
  );
};

const serveElectronYml = (
  projectId: string,
  platform: DesktopPlatform,
  fileName: string,
  client: FeedClient,
) =>
  Effect.gen(function* () {
    const file = parseElectronFeedFile(platform, fileName);
    if (file === undefined) {
      return notFound();
    }
    const picked = pickElectronRelease(yield* listFeed(projectId, platform, file.channel), file);
    yield* recordCheck(client, {
      projectId,
      platform,
      updater: "electron",
      channel: file.channel,
      arch: file.arch,
      served: servedOf(picked?.files[0]),
    });
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

/**
 * `latest/download`: a 302 to the newest fully rolled-out release's file,
 * in `format` (default: the platform's first-install preference) for `arch`.
 */
const serveLatestDownload = (projectId: string, platform: DesktopPlatform, url: URL) =>
  Effect.gen(function* () {
    const channel = queryChannel(url);
    const format = url.searchParams.get("format");
    const archName = url.searchParams.get("arch");
    const arch = archName === null ? undefined : archFromAlias(archName);
    const platformFormats: readonly string[] = DESKTOP_ARTIFACT_FORMATS[platform];
    if (channel === undefined) {
      return badRequest("Invalid channel");
    }
    if (format !== null && !platformFormats.includes(format)) {
      return badRequest(`format must be one of ${platformFormats.join(", ")}`);
    }
    if (archName !== null && arch === undefined) {
      return badRequest("arch must be x64, arm64, ia32 or armv7l");
    }
    const formats =
      format !== null && isDesktopArtifactFormat(format)
        ? ([format] as const)
        : FIRST_INSTALL_FORMATS[platform];
    const entry = pickLatestDownload(yield* listFeed(projectId, platform, channel), {
      formats,
      arch,
    });
    return entry === undefined
      ? notFound()
      : new Response(null, {
          status: 302,
          headers: {
            location: downloadUrlFor(url.origin, projectId)(entry),
            "cache-control": "public, max-age=60",
          },
        });
  });

const serveReleaseIndex = (projectId: string, url: URL) =>
  Effect.gen(function* () {
    const channel = queryChannel(url);
    if (channel === undefined) {
      return badRequest("Invalid channel");
    }
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, f) is not Array.prototype.forEach
    const lists = yield* Effect.forEach(DESKTOP_PLATFORMS, (platform) =>
      listFeed(projectId, platform, channel),
    );
    const body = renderReleaseIndex({
      channel,
      platforms: Object.fromEntries(
        DESKTOP_PLATFORMS.map((platform, index) => [platform, lists[index] ?? []]),
      ),
      downloadUrl: downloadUrlFor(url.origin, projectId),
    });
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        // A download page on the project's own site fetches it cross-origin.
        "access-control-allow-origin": "*",
      },
    });
  });

/** A request under one platform's feed directory. */
const platformEffect = (
  request: Request,
  url: URL,
  projectId: string,
  platform: DesktopPlatform,
  rest: string,
) => {
  if (platform === "linux" && rest.startsWith(APT_PREFIX)) {
    return aptEffect(request, projectId, rest.slice(APT_PREFIX.length));
  }
  const client = feedClientOf(request, url);
  if (rest === "appcast.xml") {
    return serveAppcast(projectId, platform, url, client);
  }
  if (rest === "latest/download") {
    return serveLatestDownload(projectId, platform, url);
  }
  const tauriChannel = TAURI_FEED_FILE.exec(rest)?.groups?.["channel"];
  if (tauriChannel !== undefined) {
    return serveTauriJson(projectId, [platform], tauriChannel, url, client);
  }
  if (rest.endsWith(".yml")) {
    return serveElectronYml(projectId, platform, rest, client);
  }
  return downloadEffect(request, projectId, platform, rest);
};

/** Route a `/feeds/…` request, or `null` when the path is not a feed. */
export const matchDesktopFeedRoute = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> => {
  const indexProjectId = INDEX_ROUTE.exec(url.pathname)?.groups?.["projectId"];
  const match = FEED_ROUTE.exec(url.pathname)?.groups;
  const projectId = indexProjectId ?? match?.["projectId"];
  if (projectId === undefined) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { code: "METHOD_NOT_ALLOWED", message: "Feeds are read-only" },
      { status: 405 },
    );
  }
  if (indexProjectId !== undefined) {
    return runFeedEffect(serveReleaseIndex(projectId, url), env);
  }
  const scope = match?.["scope"];
  const rest = match?.["rest"];
  if (scope === undefined || rest === undefined) {
    return notFound();
  }
  if (isDesktopPlatform(scope)) {
    const effect = platformEffect(request, url, projectId, scope, rest);
    return effect === undefined ? notFound() : runFeedEffect(effect, env);
  }
  // The remaining scope is the cross-platform Tauri feed.
  const channel = TAURI_CHANNEL_FILE.exec(rest)?.groups?.["channel"];
  return channel === undefined
    ? notFound()
    : runFeedEffect(serveTauriChannel(projectId, channel, url, feedClientOf(request, url)), env);
};
