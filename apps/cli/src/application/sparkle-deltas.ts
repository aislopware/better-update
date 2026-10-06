/**
 * Sparkle binary deltas for a macOS release, made the way Sparkle's own
 * `generate_appcast` makes them: Sparkle's `BinaryDelta` (from a pinned,
 * SHA-256-checked Sparkle release, downloaded once) patches each of the newest
 * older Sparkle-signed releases' app bundles into this build's, in the delta
 * format the old app's Sparkle can apply; a delta that saves too little is
 * dropped; each is signed with the release's EdDSA key and uploaded beside the
 * build. A Sparkle client running one of those versions then downloads the
 * changed files instead of the whole archive.
 *
 * Best-effort by contract: the full archive always works, so any failure here
 * warns and the release goes on without that delta.
 */
import { createHash } from "node:crypto";
import path from "node:path";

import { FileSystem, Effect } from "effect";

import type { BuildWithArtifact, DesktopRelease } from "@better-update/api";

import { fetchBytes } from "../lib/fetch-bytes";
import { formatCause } from "../lib/format-error";
import {
  execCapture,
  extractAppFromDmg,
  extractMacosZip,
  extractTarGz,
  findAppBundle,
  NativeRunError,
} from "../lib/native-runner";
import { printHuman } from "../lib/output";
import { parsePlist } from "../lib/plist";
import { printWarn } from "../lib/warning-style";
import { CliRuntime } from "../services/cli-runtime";
import { PresignedUploadClient } from "../services/presigned-upload";

import type { ApiClient } from "../services/api-client";

/** The Sparkle release whose BinaryDelta makes every delta. */
const SPARKLE_TOOLS = {
  version: "2.10.0",
  url: "https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-2.10.0.tar.xz",
  sha256: "c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c",
} as const;

/** Archives an app bundle is unpacked from; an installer package has none to patch. */
const DELTA_FORMATS: ReadonlySet<string> = new Set(["zip", "tar.gz", "dmg"]);

/** generate_appcast records at most this many of the framework's localizations. */
const MAX_LOCALES = 7;

const NUMERIC = /^\d+$/u;

const compareVersionParts = (left: string, right: string): number =>
  NUMERIC.test(left) && NUMERIC.test(right)
    ? Math.sign(Number(left) - Number(right))
    : Math.sign(left.localeCompare(right, "en", { numeric: true }));

/**
 * Sparkle's version order, close enough for bundle versions: dot-separated
 * parts, numeric ones compared as numbers, others as text.
 */
export const compareBundleVersions = (left: string, right: string): number => {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  return (
    Array.from({ length: Math.max(leftParts.length, rightParts.length) }, (_, index) =>
      compareVersionParts(leftParts[index] ?? "0", rightParts[index] ?? "0"),
    ).find((order) => order !== 0) ?? 0
  );
};

/**
 * The BinaryDelta format an old app's Sparkle applies, by its framework's
 * CFBundleVersion — generate_appcast's choice: 4 from Sparkle 2.7 (2041), 3
 * from 2.1 (2010), else 2; the newest when the app embeds no framework.
 */
export const deltaFormatFor = (frameworkVersion: string | undefined): number => {
  if (frameworkVersion === undefined || compareBundleVersions(frameworkVersion, "2041") >= 0) {
    return 4;
  }
  return compareBundleVersions(frameworkVersion, "2010") >= 0 ? 3 : 2;
};

/** generate_appcast keeps a delta only when it is under ⅞ of the full archive. */
export const deltaWorthIt = (deltaSize: number, archiveSize: number): boolean =>
  deltaSize / 7 <= archiveSize / 8;

/** An older release to patch from, and its bundle version (`sparkle:deltaFrom`). */
export interface DeltaSource {
  readonly release: DesktopRelease;
  readonly deltaFrom: string;
}

/**
 * The older releases to patch from: Sparkle-signed releases (their apps carry a
 * public key, so they can verify a delta) of a lower bundle version on any
 * channel — the appcast serves every channel — newest first, one per version.
 */
export const deltaSources = (
  releases: readonly DesktopRelease[],
  build: { readonly id: string; readonly buildNumber: string },
  maximum: number,
): readonly DeltaSource[] =>
  releases
    .flatMap((release) =>
      release.sparkleSigned &&
      release.buildId !== build.id &&
      release.buildNumber !== null &&
      DELTA_FORMATS.has(release.artifactFormat) &&
      compareBundleVersions(release.buildNumber, build.buildNumber) < 0
        ? [{ release, deltaFrom: release.buildNumber }]
        : [],
    )
    .filter(
      (source, index, all) =>
        all.findIndex((other) => other.deltaFrom === source.deltaFrom) === index,
    )
    .slice(0, maximum);

const fail = (message: string) => new NativeRunError({ message });

/** BinaryDelta from the pinned Sparkle release, kept in `~/.better-update/tools`. */
const binaryDeltaTool = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* (yield* CliRuntime).homeDirectory;
  const dir = path.join(home, ".better-update", "tools", `sparkle-${SPARKLE_TOOLS.version}`);
  const tool = path.join(dir, "bin", "BinaryDelta");
  if (yield* fs.exists(tool).pipe(Effect.orElseSucceed(() => false))) {
    return tool;
  }
  yield* printHuman(`Downloading Sparkle ${SPARKLE_TOOLS.version}'s BinaryDelta...`);
  const archive = yield* fetchBytes(SPARKLE_TOOLS.url, `Sparkle ${SPARKLE_TOOLS.version}`);
  if (createHash("sha256").update(archive).digest("hex") !== SPARKLE_TOOLS.sha256) {
    return yield* fail(
      `The downloaded Sparkle ${SPARKLE_TOOLS.version} archive does not match its pinned SHA-256.`,
    );
  }
  yield* fs.makeDirectory(dir, { recursive: true });
  const archivePath = path.join(dir, "Sparkle.tar.xz");
  yield* fs.writeFile(archivePath, archive);
  yield* execCapture("tar (Sparkle)", "tar", "-xf", archivePath, "-C", dir, "bin/BinaryDelta");
  yield* fs.remove(archivePath);
  return tool;
});

/** Write an archive's bytes under `dir` and unpack its app bundle there. */
const unpackApp = (format: string, bytes: Uint8Array, dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dir, { recursive: true });
    const archive = path.join(dir, `archive.${format}`);
    const appDir = path.join(dir, "app");
    yield* fs.makeDirectory(appDir);
    yield* fs.writeFile(archive, bytes);
    if (format === "dmg") {
      const mountPoint = path.join(dir, "mount");
      yield* fs.makeDirectory(mountPoint);
      return yield* extractAppFromDmg({ dmgPath: archive, mountPoint, destDir: appDir });
    }
    yield* format === "zip" ? extractMacosZip(archive, appDir) : extractTarGz(archive, appDir);
    return yield* findAppBundle(appDir);
  });

/**
 * What the appcast records of the old app's Sparkle framework: its version
 * (for the delta format), its executable's size and up to seven non-English
 * localizations — a client whose framework differs (stripped) skips the delta.
 */
const sparkleFrameworkOf = (appPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const framework = path.join(appPath, "Contents", "Frameworks", "Sparkle.framework");
    if (!(yield* fs.exists(framework).pipe(Effect.orElseSucceed(() => false)))) {
      return undefined;
    }
    const resources = yield* fs.realPath(path.join(framework, "Resources"));
    const info = parsePlist(Buffer.from(yield* fs.readFile(path.join(resources, "Info.plist"))));
    const version = info["CFBundleVersion"];
    const executable = yield* fs.stat(yield* fs.realPath(path.join(framework, "Sparkle")));
    const locales = (yield* fs.readDirectory(resources))
      .filter((name) => name.endsWith(".lproj") && name !== "en.lproj" && name !== "Base.lproj")
      .map((name) => name.slice(0, -".lproj".length))
      .toSorted()
      .slice(0, MAX_LOCALES);
    return {
      version: typeof version === "string" ? version : undefined,
      executableSize: Number(executable.size),
      locales: locales.length === 0 ? undefined : locales.join(","),
    };
  });

export interface SparkleDeltaOptions<Requirements> {
  readonly build: BuildWithArtifact;
  /** The build's archive, already checked against its SHA-256. */
  readonly bytes: Uint8Array;
  readonly maximum: number;
  /** The old artifact's verified bytes. */
  readonly readArtifact: (
    build: BuildWithArtifact,
  ) => Effect.Effect<Uint8Array, unknown, Requirements>;
  /** The release key's `sparkle:edSignature` of a file. */
  readonly sign: (bytes: Uint8Array) => Effect.Effect<string | undefined, unknown, Requirements>;
}

const makeDelta = <Requirements>(
  api: ApiClient,
  options: SparkleDeltaOptions<Requirements> & { readonly newApp: string; readonly tool: string },
  { release, deltaFrom }: DeltaSource,
  workDir: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const oldBuild = yield* api.builds.get({ params: { id: release.buildId } });
    const oldBytes = yield* options.readArtifact(oldBuild);
    const oldApp = yield* unpackApp(
      release.artifactFormat,
      oldBytes,
      path.join(workDir, release.id),
    );
    const framework = yield* sparkleFrameworkOf(oldApp);
    const deltaPath = path.join(workDir, `${release.id}.delta`);
    yield* execCapture(
      "BinaryDelta create",
      options.tool,
      "create",
      "--version",
      String(deltaFormatFor(framework?.version)),
      oldApp,
      options.newApp,
      deltaPath,
    );
    const delta = new Uint8Array(yield* fs.readFile(deltaPath));
    const percent = Math.round((delta.byteLength / options.bytes.byteLength) * 100);
    if (!deltaWorthIt(delta.byteLength, options.bytes.byteLength)) {
      return yield* printHuman(
        `Skipped the delta from ${deltaFrom}: ${String(percent)}% of the full archive saves too little.`,
      );
    }
    const edSignature = yield* options.sign(delta);
    if (edSignature === undefined) {
      return undefined;
    }
    const sha256 = createHash("sha256").update(delta).digest("hex");
    const body = { deltaFrom, sha256, byteSize: delta.byteLength };
    const reservation = yield* api.desktopReleases.reserveSparkleDelta({
      params: { id: options.build.id },
      payload: {
        ...body,
        edSignature,
        ...(framework === undefined ? {} : { sparkleExecutableSize: framework.executableSize }),
        ...(framework?.locales === undefined ? {} : { sparkleLocales: framework.locales }),
      },
    });
    yield* (yield* PresignedUploadClient).putToPresignedUrl({
      url: reservation.uploadUrl,
      filePath: deltaPath,
      byteSize: delta.byteLength,
      expiresAt: reservation.uploadExpiresAt,
      headers: reservation.uploadHeaders,
    });
    yield* api.desktopReleases.completeSparkleDelta({
      params: { id: options.build.id },
      payload: body,
    });
    yield* printHuman(
      `Uploaded the Sparkle delta from ${deltaFrom}: ${String(percent)}% of the full archive.`,
    );
    return undefined;
  });

/**
 * Make, sign and upload the build's deltas from the newest older releases
 * that do not have one yet. Never fails; a delta that cannot be made is a
 * warning.
 */
export const uploadSparkleDeltas = <Requirements>(
  api: ApiClient,
  options: SparkleDeltaOptions<Requirements>,
) =>
  Effect.gen(function* () {
    const { build } = options;
    const format = build.artifact?.format;
    const { buildNumber } = build;
    if (options.maximum <= 0 || format === undefined || !DELTA_FORMATS.has(format)) {
      return;
    }
    if (buildNumber === null) {
      return yield* printWarn(
        `Build ${build.id} records no bundle version (CFBundleVersion); no Sparkle deltas were made.`,
      );
    }
    if (process.platform !== "darwin") {
      return yield* printWarn(
        "Sparkle deltas are made with Sparkle's BinaryDelta, which runs on macOS only; this release ships without them.",
      );
    }
    const { items } = yield* api.desktopReleases.list({
      params: { projectId: build.projectId },
      query: { platform: "macos", limit: 100 },
    });
    const existing = new Set(
      (yield* api.desktopReleases.listSparkleDeltas({ params: { id: build.id } })).items.map(
        (delta) => delta.deltaFrom,
      ),
    );
    const sources = deltaSources(items, { id: build.id, buildNumber }, options.maximum).filter(
      (source) => !existing.has(source.deltaFrom),
    );
    if (sources.length === 0) {
      return;
    }
    const tool = yield* binaryDeltaTool;
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "better-update-delta-" });
        const newApp = yield* unpackApp(format, options.bytes, path.join(workDir, "new"));
        yield* Effect.all(
          sources.map((source) =>
            makeDelta(api, { ...options, newApp, tool }, source, workDir).pipe(
              Effect.catch((error) =>
                printWarn(
                  `Could not make the Sparkle delta from ${source.deltaFrom}: ${formatCause(error)}`,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }).pipe(Effect.catch((error) => printWarn(`Sparkle deltas were skipped: ${formatCause(error)}`)));
