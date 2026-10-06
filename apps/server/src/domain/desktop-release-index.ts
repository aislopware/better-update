/**
 * First-install downloads: what a website's "Download" button links to,
 * rendered from stored release rows. Pure.
 *
 * Only fully rolled-out releases count — a first install should get what
 * every updater is offered, not a candidate — and the shell has already
 * dropped halted ones.
 */
import type { DesktopArch, DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

import { entryArchitectures, feedFileName } from "./desktop-feed-files";

import type { DesktopFeedEntry } from "../desktop-release-models";
import type { DownloadUrl } from "./desktop-feed-files";

const fullyRolledOut = (entry: DesktopFeedEntry): boolean => entry.rolloutPercentage === 100;

/** A build that names no architecture is universal on a Mac and x64 elsewhere. */
const installsOn = (entry: DesktopFeedEntry, arch: DesktopArch): boolean => {
  const architectures = entryArchitectures(entry);
  if (architectures.length === 0) {
    return entry.platform === "macos" || arch === "x64";
  }
  return architectures.includes(arch);
};

/** 1 for a single-architecture build, 0 for a universal one: universal sorts first. */
const singleArch = (entry: DesktopFeedEntry): number =>
  Number(entryArchitectures(entry).length === 1);

/** A Windows or Linux link without an architecture is for x64; a Mac one takes any. */
const installsOnRequested = (entry: DesktopFeedEntry, arch: DesktopArch | undefined): boolean => {
  if (arch !== undefined) {
    return installsOn(entry, arch);
  }
  return entry.platform === "macos" || installsOn(entry, "x64");
};

/**
 * The newest fully rolled-out release matching the request, preferring the
 * formats in the order given (a DMG over a zip for a Mac's first install).
 * Without an architecture, a Windows or Linux link is for x64 and a Mac one
 * prefers a universal build.
 */
export const pickLatestDownload = (
  entries: readonly DesktopFeedEntry[],
  request: {
    readonly formats: readonly DesktopArtifactFormat[];
    readonly arch: DesktopArch | undefined;
  },
): DesktopFeedEntry | undefined => {
  const matching = entries.filter(
    (entry) =>
      fullyRolledOut(entry) &&
      request.formats.includes(entry.artifactFormat) &&
      installsOnRequested(entry, request.arch),
  );
  const [newest] = matching;
  return newest === undefined
    ? undefined
    : matching
        .filter((entry) => entry.appVersion === newest.appVersion)
        .toSorted(
          (left, right) =>
            request.formats.indexOf(left.artifactFormat) -
              request.formats.indexOf(right.artifactFormat) ||
            (request.arch === undefined ? singleArch(left) - singleArch(right) : 0),
        )
        .at(0);
};

/** The formats a first install prefers on each platform, best first. */
export const FIRST_INSTALL_FORMATS: Readonly<
  Record<DesktopPlatform, readonly DesktopArtifactFormat[]>
> = {
  macos: ["dmg", "pkg", "zip"],
  windows: ["exe", "msi"],
  linux: ["appimage", "deb", "rpm"],
};

interface IndexFile {
  readonly format: DesktopArtifactFormat;
  readonly architectures: readonly DesktopArch[];
  readonly fileName: string;
  readonly size: number;
  readonly sha512: string;
  readonly url: string;
}

interface IndexPlatform {
  readonly version: string | null;
  readonly buildNumber: string | null;
  readonly releasedAt: string;
  readonly releaseNotes: string | null;
  readonly files: readonly IndexFile[];
}

const indexFile = (entry: DesktopFeedEntry, downloadUrl: DownloadUrl): IndexFile => ({
  format: entry.artifactFormat,
  architectures: entryArchitectures(entry),
  fileName: feedFileName(entry),
  size: entry.byteSize,
  sha512: entry.sha512,
  url: downloadUrl(entry),
});

/** Files of one version that are alternatives, not duplicates: another format or architecture set. */
const fileKey = (entry: DesktopFeedEntry): string =>
  `${entry.artifactFormat}:${[...entryArchitectures(entry)].toSorted().join(",")}`;

/** One platform's newest fully rolled-out version and its files, one per format and architecture set. */
const indexPlatform = (
  entries: readonly DesktopFeedEntry[],
  downloadUrl: DownloadUrl,
): IndexPlatform | undefined => {
  const live = entries.filter(fullyRolledOut);
  const [newest] = live;
  if (newest === undefined) {
    return undefined;
  }
  const files = live
    .filter((entry) => entry.appVersion === newest.appVersion)
    .filter(
      (entry, index, all) => all.findIndex((other) => fileKey(other) === fileKey(entry)) === index,
    )
    .map((entry) => indexFile(entry, downloadUrl));
  return {
    version: newest.appVersion,
    buildNumber: newest.buildNumber,
    releasedAt: newest.createdAt,
    releaseNotes: newest.releaseNotes,
    files,
  };
};

/**
 * `releases.json`: per platform, the newest fully rolled-out version of the
 * channel and every file it shipped — what a download page renders.
 */
export const renderReleaseIndex = (params: {
  readonly channel: string;
  readonly platforms: Readonly<Partial<Record<DesktopPlatform, readonly DesktopFeedEntry[]>>>;
  readonly downloadUrl: DownloadUrl;
}): string =>
  JSON.stringify({
    channel: params.channel,
    platforms: Object.fromEntries(
      Object.entries(params.platforms).flatMap(([platform, entries]) => {
        const indexed = indexPlatform(entries, params.downloadUrl);
        return indexed === undefined ? [] : [[platform, indexed]];
      }),
    ),
  });
