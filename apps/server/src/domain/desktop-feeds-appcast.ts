/**
 * Sparkle-family appcasts, rendered from stored release rows. Pure; the shell
 * resolves rollout membership.
 *
 * - Sparkle 2 (macOS `appcast.xml`): every live release, newest first. The
 *   default channel (`latest`) is untagged; any other is `sparkle:channel`, so
 *   one appcast serves every channel an app opts into. Sparkle picks the
 *   highest version the client may install, so an older item stays useful to a
 *   client a newer release's rollout, minimum OS or hardware excludes. An
 *   Apple-silicon-only build requires arm64 (Intel Macs skip it); a phased
 *   release is Sparkle's own time-based rollout.
 * - WinSparkle (Windows `appcast.xml`): one item per version, with one
 *   enclosure per installer marked `sparkle:os="windows-<arch>"` (WinSparkle
 *   prefers the exact architecture). WinSparkle has no channels, so the
 *   appcast serves one channel, chosen by the URL.
 */
import {
  DEFAULT_DESKTOP_CHANNEL,
  readDesktopBuildMetadata,
  readMacosBuildMetadata,
} from "@better-update/api";

import type { DesktopArch } from "@better-update/api";

import { escapeXml } from "../lib/xml";
import { entryArchitectures, soleArchitecture } from "./desktop-feed-files";

import type { DesktopFeedEntry, SparkleDeltaModel } from "../desktop-release-models";
import type { DeltaUrl, DownloadUrl } from "./desktop-feed-files";

/** RFC 822 with a numeric zone, the form Sparkle's date parser expects. */
const rfc822 = (iso: string): string => new Date(iso).toUTCString().replace("GMT", "+0000");

/** Plain-text notes as HTML Sparkle can show: escaped, line breaks kept. */
const notesHtml = (notes: string): string =>
  notes
    .split(/\n{2,}/u)
    .map((paragraph) => `<p>${escapeXml(paragraph).replaceAll("\n", "<br/>")}</p>`)
    .join("");

const notesElement = (entry: DesktopFeedEntry): readonly string[] =>
  entry.releaseNotes === null
    ? []
    : [`      <description><![CDATA[${notesHtml(entry.releaseNotes)}]]></description>`];

/** The version Sparkle compares (`CFBundleVersion`), falling back to the marketing one. */
const sparkleVersion = (entry: DesktopFeedEntry): string =>
  entry.buildNumber ?? entry.appVersion ?? entry.id;

const versionElements = (entry: DesktopFeedEntry): readonly string[] => [
  `      <title>${escapeXml(entry.appVersion ?? sparkleVersion(entry))}</title>`,
  `      <pubDate>${rfc822(entry.createdAt)}</pubDate>`,
  `      <sparkle:version>${escapeXml(sparkleVersion(entry))}</sparkle:version>`,
  ...(entry.appVersion === null
    ? []
    : [
        `      <sparkle:shortVersionString>${escapeXml(entry.appVersion)}</sparkle:shortVersionString>`,
      ]),
];

const signatureAttribute = (signature: string | null): string =>
  signature === null ? "" : ` sparkle:edSignature="${escapeXml(signature)}"`;

const minimumSystemVersionElement = (minimum: string | undefined): readonly string[] =>
  minimum === undefined
    ? []
    : [`      <sparkle:minimumSystemVersion>${escapeXml(minimum)}</sparkle:minimumSystemVersion>`];

/** A build's deltas, keyed by build id, and where each downloads from. */
export interface AppcastDeltas {
  readonly byBuild: ReadonlyMap<string, readonly SparkleDeltaModel[]>;
  readonly url: DeltaUrl;
}

/**
 * `<sparkle:deltas>`: one enclosure per older version the build patches from,
 * signed like the archive. A client takes the one whose `deltaFrom` is its own
 * `CFBundleVersion` (and whose Sparkle framework matches the size and locales
 * recorded), and falls back to the archive when applying it fails.
 */
const deltaEnclosure = (url: string, delta: SparkleDeltaModel): string =>
  [
    `        <enclosure url="${escapeXml(url)}"`,
    ` sparkle:deltaFrom="${escapeXml(delta.deltaFrom)}"`,
    ` length="${String(delta.byteSize)}" type="application/octet-stream"`,
    delta.sparkleExecutableSize === null
      ? ""
      : ` sparkle:deltaFromSparkleExecutableSize="${String(delta.sparkleExecutableSize)}"`,
    delta.sparkleLocales === null
      ? ""
      : ` sparkle:deltaFromSparkleLocales="${escapeXml(delta.sparkleLocales)}"`,
    signatureAttribute(delta.edSignature),
    "/>",
  ].join("");

const deltasElement = (
  entry: DesktopFeedEntry,
  deltas: AppcastDeltas | undefined,
): readonly string[] => {
  if (deltas === undefined) {
    return [];
  }
  const own = (deltas.byBuild.get(entry.buildId) ?? []).filter(
    (delta) => delta.deltaFrom !== sparkleVersion(entry),
  );
  return own.length === 0
    ? []
    : [
        "      <sparkle:deltas>",
        ...own.map((delta) => deltaEnclosure(deltas.url(entry, delta), delta)),
        "      </sparkle:deltas>",
      ];
};

const sparkleItem = (
  entry: DesktopFeedEntry,
  downloadUrl: DownloadUrl,
  deltas: AppcastDeltas | undefined,
): string =>
  [
    "    <item>",
    ...versionElements(entry),
    ...minimumSystemVersionElement(
      readMacosBuildMetadata(entry.metadataJson)?.minimumSystemVersion,
    ),
    ...(soleArchitecture(entry) === "arm64"
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
    ...notesElement(entry),
    `      <enclosure url="${escapeXml(downloadUrl(entry))}" length="${String(entry.byteSize)}" type="application/octet-stream"${signatureAttribute(entry.sparkleEdSignature)}/>`,
    ...deltasElement(entry, deltas),
    "    </item>",
  ].join("\n");

const rss = (title: string, items: readonly string[]): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

export const renderAppcast = (params: {
  readonly title: string;
  readonly downloadUrl: DownloadUrl;
  readonly entries: readonly DesktopFeedEntry[];
  readonly deltas?: AppcastDeltas;
}): string =>
  rss(
    params.title,
    params.entries.map((entry) => sparkleItem(entry, params.downloadUrl, params.deltas)),
  );

/** WinSparkle's `sparkle:os`: the exact architecture, or any Windows for a multi-arch installer. */
const WINDOWS_OS: Readonly<Record<DesktopArch, string>> = {
  x64: "windows-x64",
  arm64: "windows-arm64",
  ia32: "windows-x86",
  armv7l: "windows",
};

const windowsOs = (entry: DesktopFeedEntry): string => {
  const architectures = entryArchitectures(entry);
  const [only] = architectures;
  if (architectures.length === 0) {
    return WINDOWS_OS.x64;
  }
  return architectures.length === 1 && only !== undefined ? WINDOWS_OS[only] : "windows";
};

const winSparkleItem = (
  versionEntries: readonly [DesktopFeedEntry, ...DesktopFeedEntry[]],
  downloadUrl: DownloadUrl,
): string => {
  const [newest] = versionEntries;
  const minimumSystemVersion = versionEntries
    .map((entry) => readDesktopBuildMetadata("windows", entry.metadataJson)?.minimumSystemVersion)
    .find((minimum) => minimum !== undefined);
  // One enclosure per target; an `.exe` before an `.msi` for the same one.
  const enclosures = versionEntries
    .toSorted(
      (left, right) =>
        Number(left.artifactFormat !== "exe") - Number(right.artifactFormat !== "exe"),
    )
    .filter(
      (entry, index, all) =>
        all.findIndex((other) => windowsOs(other) === windowsOs(entry)) === index,
    );
  return [
    "    <item>",
    ...versionElements(newest),
    ...minimumSystemVersionElement(minimumSystemVersion),
    ...(newest.critical ? ["      <sparkle:criticalUpdate></sparkle:criticalUpdate>"] : []),
    ...notesElement(newest),
    ...enclosures.map(
      (entry) =>
        `      <enclosure url="${escapeXml(downloadUrl(entry))}" length="${String(entry.byteSize)}" type="application/octet-stream" sparkle:os="${windowsOs(entry)}"${signatureAttribute(entry.winSparkleEdSignature)}/>`,
    ),
    "    </item>",
  ].join("\n");
};

/** Installers of one app version are one update, whatever build number each carries. */
const versionOf = (entry: DesktopFeedEntry): string => entry.appVersion ?? sparkleVersion(entry);

/** A WinSparkle appcast of one channel's Windows releases, one item per version, newest first. */
export const renderWinSparkleAppcast = (params: {
  readonly title: string;
  readonly downloadUrl: DownloadUrl;
  readonly entries: readonly DesktopFeedEntry[];
}): string => {
  const versions = params.entries.reduce<
    readonly (readonly [DesktopFeedEntry, ...DesktopFeedEntry[]])[]
  >((groups, entry) => {
    const version = versionOf(entry);
    const index = groups.findIndex(([first]) => versionOf(first) === version);
    const group = groups[index];
    return group === undefined ? [...groups, [entry]] : groups.with(index, [...group, entry]);
  }, []);
  return rss(
    params.title,
    versions.map((group) => winSparkleItem(group, params.downloadUrl)),
  );
};
