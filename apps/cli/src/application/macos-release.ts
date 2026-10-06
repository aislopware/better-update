/**
 * Releasing a macOS Developer ID build to the project's update feeds: the CLI
 * hashes and signs (Sparkle EdDSA, Tauri minisign) the exact bytes the server
 * stored, so the feeds describe what a Mac will download, and cuts a zip into
 * the blockmap electron-updater's differential download needs. The private
 * keys never leave this machine.
 */
import { createHash } from "node:crypto";

import { compact } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import type { BuildWithArtifact } from "@better-update/api";

import { electronBlockmap } from "../lib/electron-blockmap";
import { InvalidArgumentError } from "../lib/exit-codes";
import { fetchBytes } from "../lib/fetch-bytes";
import { printHuman } from "../lib/output";
import { releaseSettings, sparkleSignature, tauriSignature } from "./macos-release-keys";

import type { ApiClient } from "../services/api-client";

const FEED_FORMATS = new Set(["dmg", "zip", "pkg", "tar.gz"]);

/** The build to release: an explicit id, or the newest Developer ID build. */
export const resolveReleaseBuild = (
  api: ApiClient,
  params: { readonly projectId: string; readonly buildId: string | undefined },
) =>
  Effect.gen(function* () {
    if (params.buildId !== undefined) {
      return yield* api.builds.get({ params: { id: params.buildId } });
    }
    const { items } = yield* api.builds.list({
      query: {
        projectId: params.projectId,
        platform: ["macos"],
        distribution: ["developer-id"],
        limit: 1,
      },
    });
    const [newest] = items;
    if (newest === undefined) {
      return yield* new InvalidArgumentError({
        message:
          "This project has no macOS Developer ID builds yet. Run `better-update build --platform macos` first.",
      });
    }
    return yield* api.builds.get({ params: { id: newest.id } });
  });

/**
 * The artifact's bytes, from `--file` when it is the same artifact (checked
 * against the stored SHA-256) or downloaded otherwise.
 */
const readArtifactBytes = (api: ApiClient, build: BuildWithArtifact, file: string | undefined) =>
  Effect.gen(function* () {
    const { artifact } = build;
    if (
      build.platform !== "macos" ||
      build.distribution !== "developer-id" ||
      artifact === null ||
      !FEED_FORMATS.has(artifact.format)
    ) {
      return yield* new InvalidArgumentError({
        message: `Build ${build.id} is not a finished macOS Developer ID build (dmg, zip, pkg or tar.gz); only those can be released to update feeds.`,
      });
    }
    const bytes =
      file === undefined
        ? yield* Effect.gen(function* () {
            yield* printHuman(`Downloading the ${artifact.format} to hash and sign it...`);
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

export interface CreateMacosReleaseOptions {
  readonly projectId: string;
  readonly build: BuildWithArtifact;
  readonly channel: string;
  readonly releaseNotes: string | undefined;
  readonly critical: boolean;
  readonly rolloutPercentage: number | undefined;
  readonly phasedRolloutHours: number | undefined;
  readonly file: string | undefined;
  readonly sparkleKeyFile: string | undefined;
  readonly tauriKeyFile: string | undefined;
  readonly environment: string | undefined;
}

export const createMacosRelease = (api: ApiClient, options: CreateMacosReleaseOptions) =>
  Effect.gen(function* () {
    const bytes = yield* readArtifactBytes(api, options.build, options.file);
    const setting = yield* releaseSettings(api, {
      projectId: options.projectId,
      environment: options.environment,
    });
    const sparkleEdSignature = yield* sparkleSignature({
      build: options.build,
      bytes,
      keyFile: options.sparkleKeyFile,
      setting,
    });
    const tauriSigned = yield* tauriSignature({
      build: options.build,
      bytes,
      keyFile: options.tauriKeyFile,
      setting,
    });
    return yield* api.desktopReleases.create({
      params: { projectId: options.projectId },
      payload: {
        buildId: options.build.id,
        channel: options.channel,
        sha512: createHash("sha512").update(bytes).digest("base64"),
        critical: options.critical,
        ...(options.releaseNotes === undefined ? {} : { releaseNotes: options.releaseNotes }),
        ...compact({
          rolloutPercentage: options.rolloutPercentage,
          phasedRolloutHours: options.phasedRolloutHours,
        }),
        ...compact({ sparkleEdSignature, tauriSignature: tauriSigned }),
        ...(options.build.artifact?.format === "zip"
          ? { electronBlockmap: electronBlockmap(bytes) }
          : {}),
      },
    });
  });

/** The public URLs a macOS app's updater polls. */
export const macosFeedUrls = (baseUrl: string, projectId: string, channel: string) => {
  const feedBase = `${baseUrl}/feeds/${projectId}/macos`;
  return {
    appcast: `${feedBase}/appcast.xml`,
    electron: `${feedBase}/${channel}-mac.yml`,
    tauri: `${feedBase}/${channel}-tauri.json`,
  };
};
