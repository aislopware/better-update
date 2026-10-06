/**
 * Update feeds for macOS Developer ID releases, rendered from stored release
 * rows. Pure: the shell resolves rollout membership and the download URLs.
 *
 * - Sparkle 2 appcast (`appcast.xml`): every live release, newest first. The
 *   default channel (`latest`) is untagged; any other is `sparkle:channel`, so
 *   one appcast serves every channel an app opts into. Sparkle picks the
 *   highest version the client may install, so an older item stays useful to
 *   a client a newer release's rollout, minimum OS or hardware excludes. An
 *   Apple-silicon-only build requires arm64 (Intel Macs skip it); a phased
 *   release is Sparkle's own time-based rollout.
 * - electron-updater (`<channel>-mac.yml`): the newest live `.zip` version of
 *   the channel (Squirrel.Mac installs only zips), with one file per
 *   architecture released at that version. electron-updater gives Apple
 *   silicon the file whose name says `arm64` and Intel the others, so an
 *   arm64-only build is named for it. Staged rollout is the client-side
 *   `stagingPercentage`.
 *   Each zip that carries a blockmap is also `<file>.blockmap`, so an updater
 *   holding the previous zip downloads only the chunks that changed.
 * - Tauri updater (`<channel>-tauri.json`): the newest signed `.app.tar.gz`
 *   with a semver version — the static form (`platforms.darwin-<arch>`) for a
 *   fixed endpoint, or the dynamic form for one templated with `{{arch}}`.
 */
import { DEFAULT_DESKTOP_CHANNEL, readMacosBuildMetadata } from "@better-update/api";

import { escapeXml } from "../lib/xml";

import type { DesktopFeedEntry } from "../desktop-release-models";

const SAFE_FILE_NAME = /[^A-Za-z0-9._-]+/gu;

/** The single architecture a build was made for, or undefined for a universal (or unknown) one. */
const soleArchitecture = (entry: DesktopFeedEntry): string | undefined => {
  const architectures = readMacosBuildMetadata(entry.metadataJson)?.architectures ?? [];
  return architectures.length === 1 ? architectures[0] : undefined;
};

const isArm64Only = (entry: DesktopFeedEntry): boolean => soleArchitecture(entry) === "arm64";

/** electron-updater tells Apple-silicon files by `arm64` in the name; `x64` matches its `process.arch`. */
const ARCH_SUFFIX: Readonly<Record<string, string>> = { arm64: "-arm64", x86_64: "-x64" };

/** `.app.tar.gz`, the name Tauri's bundler gives its updater archives. */
const fileExtension = (entry: DesktopFeedEntry): string =>
  entry.artifactFormat === "tar.gz" ? "app.tar.gz" : entry.artifactFormat;

/** What a download's name is made of, around the version. */
const fileNameParts = (entry: DesktopFeedEntry) => {
  const appName =
    readMacosBuildMetadata(entry.metadataJson)?.appName ?? entry.bundleId?.split(".").at(-1);
  const arch = soleArchitecture(entry);
  return {
    head: `${(appName ?? "app").replaceAll(SAFE_FILE_NAME, "-")}-`,
    version: (entry.appVersion ?? entry.buildNumber ?? entry.id.slice(0, 8)).replaceAll(
      SAFE_FILE_NAME,
      "-",
    ),
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- universal builds carry no suffix
    tail: `${arch === undefined ? "" : (ARCH_SUFFIX[arch] ?? "")}.${fileExtension(entry)}`,
  };
};

/** `<AppName>-<version>[-arm64|-x64].<ext>`, the name a download is saved under. */
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
 * electron-updater's blockmap file (before gzip): the whole archive as one
 * file named `file`, which is what the updater looks up.
 */
export const renderBlockmap = (chunks: {
  readonly checksums: readonly string[];
  readonly sizes: readonly number[];
}): string =>
  JSON.stringify({
    version: "2",
    files: [{ name: "file", offset: 0, checksums: chunks.checksums, sizes: chunks.sizes }],
  });

/** Relative to the feed directory (`/feeds/<projectId>/macos/`). */
export const feedDownloadPath = (entry: DesktopFeedEntry): string =>
  `download/${entry.id}/${feedFileName(entry)}`;

/** RFC 822 with a numeric zone, the form Sparkle's date parser expects. */
const rfc822 = (iso: string): string => new Date(iso).toUTCString().replace("GMT", "+0000");

/** Plain-text notes as HTML Sparkle can show: escaped, line breaks kept. */
const notesHtml = (notes: string): string =>
  notes
    .split(/\n{2,}/u)
    .map((paragraph) => `<p>${escapeXml(paragraph).replaceAll("\n", "<br/>")}</p>`)
    .join("");

const appcastItem = (entry: DesktopFeedEntry, feedBaseUrl: string): string => {
  const macos = readMacosBuildMetadata(entry.metadataJson);
  const version = entry.buildNumber ?? entry.appVersion ?? entry.id;
  const lines = [
    "    <item>",
    `      <title>${escapeXml(entry.appVersion ?? version)}</title>`,
    `      <pubDate>${rfc822(entry.createdAt)}</pubDate>`,
    `      <sparkle:version>${escapeXml(version)}</sparkle:version>`,
    ...(entry.appVersion === null
      ? []
      : [
          `      <sparkle:shortVersionString>${escapeXml(entry.appVersion)}</sparkle:shortVersionString>`,
        ]),
    ...(macos?.minimumSystemVersion === undefined
      ? []
      : [
          `      <sparkle:minimumSystemVersion>${escapeXml(macos.minimumSystemVersion)}</sparkle:minimumSystemVersion>`,
        ]),
    ...(isArm64Only(entry)
      ? ["      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>"]
      : []),
    ...(entry.channel === DEFAULT_DESKTOP_CHANNEL
      ? []
      : [`      <sparkle:channel>${escapeXml(entry.channel)}</sparkle:channel>`]),
    ...(entry.critical ? ["      <sparkle:criticalUpdate></sparkle:criticalUpdate>"] : []),
    ...(entry.phasedRolloutHours === null
      ? []
      : [
          `      <sparkle:phasedRolloutInterval>${String(entry.phasedRolloutHours * 3600)}</sparkle:phasedRolloutInterval>`,
        ]),
    ...(entry.releaseNotes === null
      ? []
      : [`      <description><![CDATA[${notesHtml(entry.releaseNotes)}]]></description>`]),
    `      <enclosure url="${escapeXml(`${feedBaseUrl}${feedDownloadPath(entry)}`)}" length="${String(entry.byteSize)}" type="application/octet-stream"${entry.sparkleEdSignature === null ? "" : ` sparkle:edSignature="${escapeXml(entry.sparkleEdSignature)}"`}/>`,
    "    </item>",
  ];
  return lines.join("\n");
};

export const renderAppcast = (params: {
  readonly title: string;
  /** Absolute URL of the feed directory, ending in `/`. */
  readonly feedBaseUrl: string;
  readonly entries: readonly DesktopFeedEntry[];
}): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">',
    "  <channel>",
    `    <title>${escapeXml(params.title)}</title>`,
    ...params.entries.map((entry) => appcastItem(entry, params.feedBaseUrl)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

/** electron-updater reads `<channel>-mac.yml`; `latest` is its default channel. */
export const ELECTRON_FEED_FILE = /^(?<channel>[a-z0-9][a-z0-9._-]{0,39})-mac\.yml$/u;

export interface ElectronRelease {
  readonly version: string;
  /** The version's newest arm64-only zip and newest other (Intel or universal) zip, newest first. */
  readonly files: readonly [DesktopFeedEntry, ...DesktopFeedEntry[]];
}

/**
 * The newest version electron-updater can install — `.zip` releases with an
 * app version (it compares `version` with the running app's) — and its files.
 */
export const pickElectronRelease = (
  entries: readonly DesktopFeedEntry[],
): ElectronRelease | undefined => {
  const zips = entries.filter(
    (entry) => entry.artifactFormat === "zip" && entry.appVersion !== null,
  );
  const [newest] = zips;
  const version = newest?.appVersion;
  if (newest === undefined || version === undefined || version === null) {
    return undefined;
  }
  const sameVersion = zips.filter((entry) => entry.appVersion === version);
  const other = sameVersion.find((entry) => isArm64Only(entry) !== isArm64Only(newest));
  return { version, files: other === undefined ? [newest] : [newest, other] };
};

/** YAML is a superset of JSON, so JSON string literals are valid scalars. */
const yamlString = (value: string): string => JSON.stringify(value);

export const renderElectronYml = ({ version, files }: ElectronRelease): string => {
  const [newest] = files;
  return [
    `version: ${yamlString(version)}`,
    "files:",
    ...files.flatMap((entry) => [
      `  - url: ${yamlString(feedDownloadPath(entry))}`,
      `    sha512: ${yamlString(entry.sha512)}`,
      `    size: ${String(entry.byteSize)}`,
    ]),
    // Pre-`files` clients read the single top-level file.
    `path: ${yamlString(feedDownloadPath(newest))}`,
    `sha512: ${yamlString(newest.sha512)}`,
    `releaseDate: ${yamlString(newest.createdAt)}`,
    ...(newest.releaseNotes === null ? [] : [`releaseNotes: ${yamlString(newest.releaseNotes)}`]),
    ...(newest.rolloutPercentage < 100
      ? [`stagingPercentage: ${String(newest.rolloutPercentage)}`]
      : []),
    "",
  ].join("\n");
};

/** Tauri reads `version` as semver; a leading `v` is allowed. */
const SEMVER =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Tauri's feed file for a channel. */
export const TAURI_FEED_FILE = /^(?<channel>[a-z0-9][a-z0-9._-]{0,39})-tauri\.json$/u;

/** `{{arch}}` as the Tauri updater fills it in on a Mac. */
export const TAURI_ARCHES = ["aarch64", "x86_64"] as const;
export type TauriArch = (typeof TAURI_ARCHES)[number];

export const isTauriArch = (value: string | null): value is TauriArch =>
  TAURI_ARCHES.some((arch) => arch === value);

/** The Macs a build runs on: its single architecture, or both for a universal build. */
const tauriArches = (entry: DesktopFeedEntry): readonly TauriArch[] => {
  const sole = soleArchitecture(entry);
  if (sole === "arm64") {
    return ["aarch64"];
  }
  return sole === "x86_64" ? ["x86_64"] : TAURI_ARCHES;
};

/** What the Tauri updater can install: a signed `.app.tar.gz` with a semver version. */
const tauriInstallable = (entries: readonly DesktopFeedEntry[]) =>
  entries.flatMap((entry) =>
    entry.artifactFormat === "tar.gz" &&
    entry.tauriSignature !== null &&
    entry.appVersion !== null &&
    SEMVER.test(entry.appVersion)
      ? [{ entry, version: entry.appVersion, signature: entry.tauriSignature }]
      : [],
  );

type TauriInstallable = ReturnType<typeof tauriInstallable>[number];

const tauriCommon = (item: TauriInstallable) => ({
  version: item.version,
  ...(item.entry.releaseNotes === null ? {} : { notes: item.entry.releaseNotes }),
  pub_date: item.entry.createdAt,
});

const tauriPlatform = (item: TauriInstallable, feedBaseUrl: string) => ({
  url: `${feedBaseUrl}${feedDownloadPath(item.entry)}`,
  signature: item.signature,
});

/**
 * Tauri's static form: the newest installable version, with a
 * `darwin-<arch>` entry for every Mac architecture a release of that version
 * covers (Tauri has no universal key, so a universal build fills both).
 * Undefined when nothing is installable — the endpoint answers 204.
 */
export const renderTauriStatic = (
  entries: readonly DesktopFeedEntry[],
  feedBaseUrl: string,
): string | undefined => {
  const installable = tauriInstallable(entries);
  const [newest] = installable;
  if (newest === undefined) {
    return undefined;
  }
  const sameVersion = installable.filter((item) => item.version === newest.version);
  const platforms = Object.fromEntries(
    TAURI_ARCHES.flatMap((arch) => {
      const item = sameVersion.find((candidate) => tauriArches(candidate.entry).includes(arch));
      return item === undefined ? [] : [[`darwin-${arch}`, tauriPlatform(item, feedBaseUrl)]];
    }),
  );
  return JSON.stringify({ ...tauriCommon(newest), platforms });
};

/**
 * Tauri's dynamic form for an endpoint templated with `{{arch}}`: the newest
 * installable release that runs on `arch`, or undefined (204, no update).
 */
export const renderTauriDynamic = (
  entries: readonly DesktopFeedEntry[],
  arch: TauriArch,
  feedBaseUrl: string,
): string | undefined => {
  const item = tauriInstallable(entries).find((candidate) =>
    tauriArches(candidate.entry).includes(arch),
  );
  return item === undefined
    ? undefined
    : JSON.stringify({ ...tauriCommon(item), ...tauriPlatform(item, feedBaseUrl) });
};
