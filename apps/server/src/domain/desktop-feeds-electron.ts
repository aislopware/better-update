/**
 * electron-updater channel files, rendered from stored release rows. Pure.
 *
 * - macOS `<channel>-mac.yml`: the newest `.zip` version (Squirrel.Mac
 *   installs only zips), its arm64-only zip and its other one — the updater
 *   gives Apple silicon the file whose name says `arm64`.
 * - Windows `<channel>.yml`: the newest NSIS `.exe` version, one installer per
 *   architecture (the updater prefers the URL naming `process.arch`).
 * - Linux `<channel>-linux[-arm64|-arm|-ia32].yml`, one file per CPU
 *   architecture: the newest version's AppImage, deb and rpm (the updater
 *   takes the AppImage, or the package type the app was installed as).
 *
 * Staged rollout is the client-side `stagingPercentage`; `minimumSystemVersion`
 * is the kernel version the updater compares `os.release()` with.
 */
import type { DesktopArch, DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

import {
  electronMinimumSystemVersion,
  embeddedBlockMapSize,
  entryArchitectures,
  feedDownloadPath,
  runsOn,
} from "./desktop-feed-files";

import type { DesktopFeedEntry } from "../desktop-release-models";

const CHANNEL = "(?<channel>[a-z0-9][a-z0-9._-]{0,39})";

const MAC_FILE = new RegExp(`^${CHANNEL}-mac\\.yml$`, "u");
const LINUX_FILE = new RegExp(`^${CHANNEL}-linux(?<arch>-arm64|-arm|-ia32)?\\.yml$`, "u");
// Windows has no platform suffix ("for historical reasons", electron-updater).
const WINDOWS_FILE = new RegExp(`^${CHANNEL}\\.yml$`, "u");

/** electron-updater names Linux channel files after `process.arch`; `arm` is armv7l. */
const LINUX_ARCH: Readonly<Record<string, DesktopArch>> = {
  "": "x64",
  "-arm64": "arm64",
  "-arm": "armv7l",
  "-ia32": "ia32",
};

/** What one electron-updater channel file serves. */
export interface ElectronFeedFile {
  readonly channel: string;
  /** Formats the platform's updaters install, preferred first. */
  readonly formats: readonly DesktopArtifactFormat[];
  /** Linux: the architecture the file is for. */
  readonly arch?: DesktopArch;
}

/** The channel file a request names, or undefined when it is not one of `platform`'s. */
export const parseElectronFeedFile = (
  platform: DesktopPlatform,
  fileName: string,
): ElectronFeedFile | undefined => {
  if (platform === "macos") {
    const channel = MAC_FILE.exec(fileName)?.groups?.["channel"];
    return channel === undefined ? undefined : { channel, formats: ["zip"] };
  }
  if (platform === "linux") {
    const groups = LINUX_FILE.exec(fileName)?.groups;
    const channel = groups?.["channel"];
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- no suffix is x64's file
    const arch = LINUX_ARCH[groups?.["arch"] ?? ""];
    return channel === undefined || arch === undefined
      ? undefined
      : { channel, formats: ["appimage", "deb", "rpm"], arch };
  }
  const channel = WINDOWS_FILE.exec(fileName)?.groups?.["channel"];
  return channel === undefined ? undefined : { channel, formats: ["exe"] };
};

export interface ElectronRelease {
  readonly version: string;
  /** The version's newest file per format and architecture set, newest first. */
  readonly files: readonly [DesktopFeedEntry, ...DesktopFeedEntry[]];
}

/**
 * What makes two files of one version alternatives rather than duplicates:
 * on a Mac, being arm64-only or not (the updater splits on `arm64` alone);
 * elsewhere, the format and the architectures.
 */
const fileKey = (entry: DesktopFeedEntry): string => {
  const architectures = entryArchitectures(entry);
  if (entry.platform === "macos") {
    return architectures.length === 1 && architectures[0] === "arm64" ? "arm64" : "other";
  }
  return `${entry.artifactFormat}:${[...architectures].toSorted().join(",")}`;
};

/**
 * The newest version electron-updater can install from `file` — releases in
 * its formats (and architecture) with an app version, which it compares with
 * the running app's — and that version's files.
 */
export const pickElectronRelease = (
  entries: readonly DesktopFeedEntry[],
  file: Pick<ElectronFeedFile, "formats" | "arch">,
): ElectronRelease | undefined => {
  const candidates = entries.filter(
    (entry) =>
      file.formats.includes(entry.artifactFormat) &&
      entry.appVersion !== null &&
      (file.arch === undefined || runsOn(entry, file.arch)),
  );
  const [newest] = candidates;
  const version = newest?.appVersion;
  if (newest === undefined || version === undefined || version === null) {
    return undefined;
  }
  const files = candidates
    .filter((entry) => entry.appVersion === version)
    .reduce<readonly DesktopFeedEntry[]>(
      (picked, entry) =>
        picked.some((chosen) => fileKey(chosen) === fileKey(entry)) ? picked : [...picked, entry],
      [],
    );
  return { version, files: [newest, ...files.filter((entry) => entry !== newest)] };
};

/** YAML is a superset of JSON, so JSON string literals are valid scalars. */
const yamlString = (value: string): string => JSON.stringify(value);

export const renderElectronYml = ({ version, files }: ElectronRelease): string => {
  const [newest] = files;
  // Files of one version share one minimum; whichever build recorded it.
  const minimumSystemVersion = files
    .map((entry) => electronMinimumSystemVersion(entry))
    .find((minimum) => minimum !== undefined);
  return [
    `version: ${yamlString(version)}`,
    "files:",
    ...files.flatMap((entry) => {
      const blockMapSize = embeddedBlockMapSize(entry);
      return [
        `  - url: ${yamlString(feedDownloadPath(entry))}`,
        `    sha512: ${yamlString(entry.sha512)}`,
        `    size: ${String(entry.byteSize)}`,
        ...(blockMapSize === undefined ? [] : [`    blockMapSize: ${String(blockMapSize)}`]),
      ];
    }),
    // Pre-`files` clients read the single top-level file.
    `path: ${yamlString(feedDownloadPath(newest))}`,
    `sha512: ${yamlString(newest.sha512)}`,
    `releaseDate: ${yamlString(newest.createdAt)}`,
    ...(newest.releaseNotes === null ? [] : [`releaseNotes: ${yamlString(newest.releaseNotes)}`]),
    ...(minimumSystemVersion === undefined
      ? []
      : [`minimumSystemVersion: ${yamlString(minimumSystemVersion)}`]),
    ...(newest.rolloutPercentage < 100
      ? [`stagingPercentage: ${String(newest.rolloutPercentage)}`]
      : []),
    "",
  ].join("\n");
};
