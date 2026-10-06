/**
 * Releasing desktop builds to the project's update feeds: the CLI hashes and
 * signs (Sparkle / WinSparkle EdDSA, Tauri minisign) the exact bytes the
 * server stored, so the feeds describe what an installed app will download,
 * and cuts a macOS zip or an NSIS installer into the blockmap
 * electron-updater's differential download needs. The private keys never
 * leave this machine.
 */
import { createHash } from "node:crypto";

import { DESKTOP_ARTIFACT_FORMATS } from "@better-update/api";
import { compact } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import type { BuildWithArtifact, DesktopPlatform } from "@better-update/api";

import { electronBlockmap } from "../lib/electron-blockmap";
import { InvalidArgumentError } from "../lib/exit-codes";
import { fetchBytes } from "../lib/fetch-bytes";
import { printHuman } from "../lib/output";
import {
  releaseSettings,
  sparkleSignature,
  tauriSignature,
  winSparkleSignature,
} from "./desktop-release-keys";

import type { ApiClient } from "../services/api-client";

export const PLATFORM_LABELS: Record<DesktopPlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** The one distribution of each platform that update feeds serve. */
const FEED_DISTRIBUTION = {
  macos: "developer-id",
  windows: "direct",
  linux: "direct",
} as const satisfies Record<DesktopPlatform, string>;

const FEED_FORMAT_LIST: Record<DesktopPlatform, string> = {
  macos: "dmg, zip, pkg or tar.gz",
  windows: "exe or msi",
  linux: "AppImage, deb or rpm",
};

/** How many builds the default pick looks through for the newest version's siblings. */
const RECENT_BUILDS = 50;

/**
 * Builds with no release on `channel` yet, among the newest version's: an
 * electron-builder or Tauri run uploads one build per installer and package,
 * and a release of that version should ship them all.
 */
const unreleasedOfNewestVersion = (
  api: ApiClient,
  params: {
    readonly projectId: string;
    readonly platform: DesktopPlatform;
    readonly channel: string;
  },
) =>
  Effect.gen(function* () {
    const { projectId, platform, channel } = params;
    const label = PLATFORM_LABELS[platform];
    const { items } = yield* api.builds.list({
      query: {
        projectId,
        platform: [platform],
        distribution: [FEED_DISTRIBUTION[platform]],
        limit: RECENT_BUILDS,
      },
    });
    const [newest] = items;
    if (newest === undefined) {
      return yield* new InvalidArgumentError({
        message: `This project has no ${label} builds to release yet. Run \`better-update build --platform ${platform}\` or \`better-update builds upload --platform ${platform}\` first.`,
      });
    }
    const { items: released } = yield* api.desktopReleases.list({
      params: { projectId },
      query: { platform, channel, limit: 100 },
    });
    const releasedIds = new Set(released.map((release) => release.buildId));
    const candidates = items.filter(
      (build) => build.appVersion === newest.appVersion && !releasedIds.has(build.id),
    );
    if (candidates.length === 0) {
      return yield* new InvalidArgumentError({
        message: `Every ${label} build of version ${newest.appVersion ?? "(none)"} is already released to "${channel}". Pass a build ID to release another.`,
      });
    }
    return candidates.map((build) => build.id);
  });

/**
 * The builds to release: the ids given, or every unreleased build of the
 * newest version. Refuses one of another platform up front, before any
 * download or signing.
 */
export const resolveReleaseBuilds = (
  api: ApiClient,
  params: {
    readonly projectId: string;
    readonly platform: DesktopPlatform;
    readonly buildIds: readonly string[];
    readonly channel: string;
  },
) =>
  Effect.gen(function* () {
    const ids =
      params.buildIds.length > 0 ? params.buildIds : yield* unreleasedOfNewestVersion(api, params);
    const builds = yield* Effect.all(ids.map((id) => api.builds.get({ params: { id } })));
    const misfit = builds.find((build) => build.platform !== params.platform);
    if (misfit !== undefined) {
      return yield* new InvalidArgumentError({
        message: `Build ${misfit.id} is a ${misfit.platform} build; release it with \`better-update ${misfit.platform} release create\`.`,
      });
    }
    return builds;
  });

/** The artifact's format when the build can go to an update feed, else a message saying why not. */
const releasableFormat = (build: BuildWithArtifact, platform: DesktopPlatform) => {
  const format = build.artifact?.format;
  const formats: readonly string[] = DESKTOP_ARTIFACT_FORMATS[platform];
  return build.platform === platform &&
    build.distribution === FEED_DISTRIBUTION[platform] &&
    format !== undefined &&
    formats.includes(format)
    ? format
    : undefined;
};

/**
 * The artifact's bytes, from `--file` when it is the same artifact (checked
 * against the stored SHA-256) or downloaded otherwise.
 */
const readArtifactBytes = (
  api: ApiClient,
  build: BuildWithArtifact,
  platform: DesktopPlatform,
  file: string | undefined,
) =>
  Effect.gen(function* () {
    const { artifact } = build;
    const format = releasableFormat(build, platform);
    if (artifact === null || format === undefined) {
      return yield* new InvalidArgumentError({
        message: `Build ${build.id} is not a finished ${PLATFORM_LABELS[platform]} ${platform === "macos" ? "Developer ID " : ""}build (${FEED_FORMAT_LIST[platform]}); only those can be released to update feeds.`,
      });
    }
    const bytes =
      file === undefined
        ? yield* Effect.gen(function* () {
            yield* printHuman(`Downloading build ${build.id}'s ${format} to hash and sign it...`);
            const link = yield* api.builds.getInstallLink({ params: { id: build.id } });
            return yield* fetchBytes(link.artifactUrl, "artifact");
          })
        : yield* (yield* FileSystem.FileSystem).readFile(file).pipe(
            Effect.mapError(
              (cause) =>
                new InvalidArgumentError({
                  message: `Could not read --file "${file}": ${String(cause)}`,
                }),
            ),
          );
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256.toLowerCase()) {
      return yield* new InvalidArgumentError({
        message:
          file === undefined
            ? `The downloaded artifact does not match build ${build.id}'s SHA-256; retry the release.`
            : `--file "${file}" is not build ${build.id}'s artifact (SHA-256 differs). Pass the exact file the build uploaded, or omit --file to download it.`,
      });
    }
    return bytes;
  });

export interface DesktopReleaseKeys {
  readonly sparkleKeyFile: string | undefined;
  readonly winSparkleKeyFile: string | undefined;
  readonly tauriKeyFile: string | undefined;
  readonly environment: string | undefined;
}

export interface CreateDesktopReleasesOptions {
  readonly projectId: string;
  readonly platform: DesktopPlatform;
  readonly builds: readonly BuildWithArtifact[];
  readonly channel: string;
  readonly releaseNotes: string | undefined;
  readonly critical: boolean;
  readonly rolloutPercentage: number | undefined;
  readonly phasedRolloutHours: number | undefined;
  /** A local copy of the one build's artifact; refused with several builds. */
  readonly file: string | undefined;
  readonly keys: DesktopReleaseKeys;
}

/** Hash, sign and publish each build, in turn, so a bad key fails before most uploads. */
export const createDesktopReleases = (api: ApiClient, options: CreateDesktopReleasesOptions) =>
  Effect.gen(function* () {
    if (options.file !== undefined && options.builds.length > 1) {
      return yield* new InvalidArgumentError({
        message: `--file names one artifact, but ${String(options.builds.length)} builds are being released. Release them one at a time, or omit --file.`,
      });
    }
    const setting = yield* releaseSettings(api, {
      projectId: options.projectId,
      environment: options.keys.environment,
    });
    const { platform, keys } = options;
    return yield* Effect.all(
      options.builds.map((build) =>
        Effect.gen(function* () {
          const bytes = yield* readArtifactBytes(api, build, platform, options.file);
          const sign = (keyFile: string | undefined) => ({ build, bytes, keyFile, setting });
          const sparkleEdSignature =
            platform === "macos" ? yield* sparkleSignature(sign(keys.sparkleKeyFile)) : undefined;
          const winSparkleEdSignature =
            platform === "windows"
              ? yield* winSparkleSignature(sign(keys.winSparkleKeyFile))
              : undefined;
          const tauriSigned = yield* tauriSignature(sign(keys.tauriKeyFile));
          const format = build.artifact?.format;
          return yield* api.desktopReleases.create({
            params: { projectId: options.projectId },
            payload: {
              buildId: build.id,
              channel: options.channel,
              sha512: createHash("sha512").update(bytes).digest("base64"),
              critical: options.critical,
              ...compact({
                releaseNotes: options.releaseNotes,
                rolloutPercentage: options.rolloutPercentage,
                phasedRolloutHours: options.phasedRolloutHours,
                sparkleEdSignature,
                winSparkleEdSignature,
                tauriSignature: tauriSigned,
              }),
              ...(format === "zip" || format === "exe"
                ? { electronBlockmap: electronBlockmap(bytes) }
                : {}),
            },
          });
        }),
      ),
    );
  });
