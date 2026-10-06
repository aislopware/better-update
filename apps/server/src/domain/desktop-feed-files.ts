/**
 * What every desktop feed says about a release's file: the architectures it
 * runs on, the name a download is saved under, its blockmap, and the minimum
 * OS version in the form each updater compares. Pure.
 *
 * Names follow electron-builder's conventions, because electron-updater picks
 * a file by its extension and then by the CPU architecture in its URL, and
 * finds the blockmap of the version it runs by putting that version in place
 * of the new one in the new file's URL.
 */
import { readDesktopBuildMetadata, readMacosBuildMetadata } from "@better-update/api";

import type { DesktopArch, DesktopArtifactFormat } from "@better-update/api";

import type { DesktopFeedEntry } from "../desktop-release-models";

const SAFE_FILE_NAME = /[^A-Za-z0-9._-]+/gu;

const safe = (value: string): string => value.replaceAll(SAFE_FILE_NAME, "-");

/** A Mac build's `lipo -archs` names, in the vocabulary of the other platforms. */
const MACOS_ARCH: Readonly<Record<string, DesktopArch>> = { arm64: "arm64", x86_64: "x64" };

/**
 * The architectures a release's build runs on, in Node's `process.arch`
 * names (`armv7l` for 32-bit ARM); empty when the build did not record them.
 */
export const entryArchitectures = (entry: DesktopFeedEntry): readonly DesktopArch[] =>
  entry.platform === "macos"
    ? (readMacosBuildMetadata(entry.metadataJson)?.architectures ?? []).flatMap((arch) => {
        const known = MACOS_ARCH[arch];
        return known === undefined ? [] : [known];
      })
    : (readDesktopBuildMetadata(entry.platform, entry.metadataJson)?.architectures ?? []);

/** The single architecture a build was made for, or undefined for a multi-arch (or unknown) one. */
export const soleArchitecture = (entry: DesktopFeedEntry): DesktopArch | undefined => {
  const architectures = entryArchitectures(entry);
  return architectures.length === 1 ? architectures[0] : undefined;
};

/** Whether the release installs on `arch`; a build that names no architecture installs on x64. */
export const runsOn = (entry: DesktopFeedEntry, arch: DesktopArch): boolean => {
  const architectures = entryArchitectures(entry);
  return architectures.length === 0 ? arch === "x64" : architectures.includes(arch);
};

const desktopMetadata = (entry: DesktopFeedEntry) =>
  entry.platform === "macos"
    ? undefined
    : readDesktopBuildMetadata(entry.platform, entry.metadataJson);

/** The product name a download is named after. */
export const entryAppName = (entry: DesktopFeedEntry): string | undefined =>
  (entry.platform === "macos"
    ? readMacosBuildMetadata(entry.metadataJson)?.appName
    : desktopMetadata(entry)?.appName) ?? entry.bundleId?.split(".").at(-1);

/** electron-builder's arch suffixes: `-x64` too, so an x64 machine finds its file among others. */
const ARCH_SUFFIX: Readonly<Record<DesktopArch, string>> = {
  x64: "-x64",
  arm64: "-arm64",
  ia32: "-ia32",
  armv7l: "-armv7l",
};

/** An AppImage names x64 by default and the others by their AppImage arch. */
const APPIMAGE_SUFFIX: Readonly<Record<DesktopArch, string>> = {
  x64: "",
  arm64: "-arm64",
  ia32: "-i386",
  armv7l: "-armv7l",
};

const DEB_ARCH: Readonly<Record<DesktopArch, string>> = {
  x64: "amd64",
  arm64: "arm64",
  ia32: "i386",
  armv7l: "armhf",
};

const RPM_ARCH: Readonly<Record<DesktopArch, string>> = {
  x64: "x86_64",
  arm64: "aarch64",
  ia32: "i686",
  armv7l: "armv7hl",
};

interface FileNameParts {
  readonly head: string;
  readonly version: string;
  readonly tail: string;
}

interface NameInputs {
  readonly app: string;
  readonly packageName: string;
  readonly arch: DesktopArch | undefined;
  /** electron-builder's `-<arch>` suffix; none for a multi-arch build. */
  readonly suffix: string;
}

/** Each format's name around the version: electron-builder's (and Tauri's) conventions. */
const NAMES: Readonly<
  Record<DesktopArtifactFormat, (inputs: NameInputs) => Omit<FileNameParts, "version">>
> = {
  dmg: ({ app, suffix }) => ({ head: `${app}-`, tail: `${suffix}.dmg` }),
  zip: ({ app, suffix }) => ({ head: `${app}-`, tail: `${suffix}.zip` }),
  pkg: ({ app, suffix }) => ({ head: `${app}-`, tail: `${suffix}.pkg` }),
  // The `.app.tar.gz` Tauri's bundler names its macOS updater archive.
  "tar.gz": ({ app, suffix }) => ({ head: `${app}-`, tail: `${suffix}.app.tar.gz` }),
  exe: ({ app, suffix }) => ({ head: `${app}-Setup-`, tail: `${suffix}.exe` }),
  msi: ({ app, suffix }) => ({ head: `${app}-`, tail: `${suffix}.msi` }),
  appimage: ({ app, arch }) => ({
    head: `${app}-`,
    tail: `${arch === undefined ? "" : APPIMAGE_SUFFIX[arch]}.AppImage`,
  }),
  deb: ({ packageName, arch }) => ({
    head: `${packageName}_`,
    tail: `_${DEB_ARCH[arch ?? "x64"]}.deb`,
  }),
  rpm: ({ packageName, arch }) => ({
    head: `${packageName}-`,
    tail: `.${RPM_ARCH[arch ?? "x64"]}.rpm`,
  }),
};

/** What a download's name is made of, around the version. */
const fileNameParts = (entry: DesktopFeedEntry): FileNameParts => {
  const app = safe(entryAppName(entry) ?? "app");
  const arch = soleArchitecture(entry);
  const { head, tail } = NAMES[entry.artifactFormat]({
    app,
    packageName: safe(desktopMetadata(entry)?.packageName ?? app.toLowerCase()),
    arch,
    suffix: arch === undefined ? "" : ARCH_SUFFIX[arch],
  });
  return {
    head,
    version: safe(entry.appVersion ?? entry.buildNumber ?? entry.id.slice(0, 8)),
    tail,
  };
};

/** The name a download is saved under, e.g. `App-Setup-1.2.0-x64.exe`, `app_1.2.0_amd64.deb`. */
export const feedFileName = (entry: DesktopFeedEntry): string => {
  const { head, version, tail } = fileNameParts(entry);
  return `${head}${version}${tail}`;
};

/** Where the blockmap of a build's artifact is stored: next to the artifact. */
export const artifactBlockmapKey = (artifactKey: string): string => `${artifactKey}.blockmap`;

/**
 * electron-updater finds the blockmap of the version it runs by putting that
 * version in place of the new one in the new file's URL — so under the new
 * release's id. The version a requested `<file>.blockmap` names, when it is
 * `entry`'s file name with another version; undefined otherwise.
 */
export const blockmapVersionOf = (
  entry: DesktopFeedEntry,
  requestedFileName: string,
): string | undefined => {
  const { head, tail } = fileNameParts(entry);
  const version = requestedFileName.slice(head.length, requestedFileName.length - tail.length);
  return requestedFileName.startsWith(head) &&
    requestedFileName.endsWith(tail) &&
    requestedFileName.length > head.length + tail.length &&
    !version.includes("/")
    ? version
    : undefined;
};

/**
 * electron-updater's blockmap file (before gzip): the whole file as one
 * entry named `file`, which is what the updater looks up.
 */
export const renderBlockmap = (chunks: {
  readonly checksums: readonly string[];
  readonly sizes: readonly number[];
}): string =>
  JSON.stringify({
    version: "2",
    files: [{ name: "file", offset: 0, checksums: chunks.checksums, sizes: chunks.sizes }],
  });

/** Where an updater downloads a release from (an absolute URL). */
export type DownloadUrl = (entry: DesktopFeedEntry) => string;

/** Relative to the platform's feed directory (`/feeds/<projectId>/<platform>/`). */
export const feedDownloadPath = (entry: DesktopFeedEntry): string =>
  `download/${entry.id}/${feedFileName(entry)}`;

const VERSION_PARTS = /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?$/u;

/**
 * The Darwin kernel version (`os.release()`) of the oldest macOS a build
 * runs on — what electron-updater compares `minimumSystemVersion` with.
 * macOS 10.x is Darwin x+4 and 11–15 are Darwin +9; from 26 the numbering
 * changed (26.4 reports Darwin 25.4, 27.0 reports 27.0), so a later macOS
 * maps to one below its own number. Every value is a lower bound: an
 * overestimate would hide updates from Macs that can run them.
 */
export const darwinVersionOf = (macosVersion: string): string | undefined => {
  const groups = VERSION_PARTS.exec(macosVersion.trim())?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const major = Number(groups["major"]);
  const minor = Number(groups["minor"] ?? "0");
  if (major === 10) {
    return minor >= 4 ? `${String(minor + 4)}.0.0` : undefined;
  }
  if (major >= 11 && major <= 15) {
    return `${String(major + 9)}.0.0`;
  }
  return major >= 26 ? `${String(major - 1)}.0.0` : undefined;
};

/** A Windows version (`10.0.17763`) as the full semver electron-updater compares `os.release()` with. */
export const windowsReleaseVersionOf = (windowsVersion: string): string | undefined => {
  const groups = VERSION_PARTS.exec(windowsVersion.trim())?.groups;
  return groups === undefined
    ? undefined
    : [groups["major"], groups["minor"] ?? "0", groups["patch"] ?? "0"].map(Number).join(".");
};

/** What electron-updater should compare against `os.release()`, for the platforms that have one. */
export const electronMinimumSystemVersion = (entry: DesktopFeedEntry): string | undefined => {
  if (entry.platform === "macos") {
    const minimum = readMacosBuildMetadata(entry.metadataJson)?.minimumSystemVersion;
    return minimum === undefined ? undefined : darwinVersionOf(minimum);
  }
  const minimum =
    entry.platform === "windows" ? desktopMetadata(entry)?.minimumSystemVersion : undefined;
  return minimum === undefined ? undefined : windowsReleaseVersionOf(minimum);
};

/** An AppImage's embedded blockmap size, which electron-updater needs to read it. */
export const embeddedBlockMapSize = (entry: DesktopFeedEntry): number | undefined =>
  entry.artifactFormat === "appimage" ? desktopMetadata(entry)?.blockMapSize : undefined;
