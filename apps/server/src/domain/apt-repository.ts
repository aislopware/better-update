import { readDesktopBuildMetadata } from "@better-update/api";
/**
 * An APT repository over a project's Linux deb releases, rendered from stored
 * release rows. Pure: the shell hashes, signs and serves what this returns.
 *
 *   <base>/dists/<channel>/InRelease                          signed Release
 *   <base>/dists/<channel>/main/binary-<arch>/Packages        one stanza per deb
 *   <base>/dists/<channel>/main/binary-<arch>/by-hash/SHA256/<digest>
 *   <base>/pool/<releaseId>/<file>.deb                        the deb itself
 *
 * A channel is a suite with one component, `main`. A `Packages` stanza is the
 * deb's own control file (so apt sees the version, dependencies and
 * description dpkg will install) plus where the deb is and its digests. An
 * architecture-independent deb (`Architecture: all`) is listed under every
 * architecture.
 *
 * Every live version is listed, so a release below 100 % carries apt's
 * `Phased-Update-Percentage`: apt upgrades that share of machines to it and
 * keeps the rest on the newest version before it.
 */
import { fromBase64, toHex } from "@better-update/encoding";

import { feedFileName } from "./desktop-feed-files";

import type { DesktopFeedEntry } from "../desktop-release-models";

/** The Debian architectures every suite indexes, an empty `Packages` where nothing is released. */
export const APT_ARCHITECTURES = ["amd64", "arm64", "armhf", "i386"] as const;
export type AptArchitecture = (typeof APT_ARCHITECTURES)[number];

export const APT_COMPONENT = "main";

/** Fields the repository writes into a stanza itself; a control file's own are dropped. */
const REPOSITORY_FIELDS = new Set([
  "filename",
  "size",
  "md5sum",
  "sha1",
  "sha256",
  "sha512",
  "phased-update-percentage",
]);

type ControlField = readonly [name: string, value: string];

const fieldValue = (fields: readonly ControlField[], name: string): string | undefined =>
  fields.find(([field]) => field.toLowerCase() === name.toLowerCase())?.[1];

/** A control file's fields and the three apt cannot do without. */
export interface ParsedControl {
  readonly fields: readonly ControlField[];
  readonly name: string;
  readonly version: string;
  /** `all`, or the Debian architecture it installs on. */
  readonly architecture: string;
}

/**
 * The fields of a control file's first paragraph, in order, each value with
 * its continuation lines. Undefined when it lacks `Package`, `Version` or
 * `Architecture`.
 */
export const parseControl = (control: string): ParsedControl | undefined => {
  const [paragraph = ""] = control
    .replaceAll("\r\n", "\n")
    .trim()
    .split(/\n[ \t]*\n/u);
  const fields = paragraph.split("\n").reduce<ControlField[]>((acc, line) => {
    const last = acc.at(-1);
    if (/^[ \t]/u.test(line)) {
      return last === undefined ? acc : [...acc.slice(0, -1), [last[0], `${last[1]}\n${line}`]];
    }
    const separator = line.indexOf(":");
    return separator > 0
      ? [...acc, [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
      : acc;
  }, []);
  const name = fieldValue(fields, "Package");
  const version = fieldValue(fields, "Version");
  const architecture = fieldValue(fields, "Architecture");
  return name && version && architecture ? { fields, name, version, architecture } : undefined;
};

/** A deb release the repository can list: its control file parses. */
export interface AptPackage extends ParsedControl {
  readonly entry: DesktopFeedEntry;
}

const packageKey = (pkg: AptPackage): string => `${pkg.name} ${pkg.version} ${pkg.architecture}`;

/**
 * The debs `entries` (newest first) hold that APT can list: those whose
 * build recorded a control file, one per package, version and architecture
 * (the newest release of a deb released twice).
 */
export const aptPackages = (entries: readonly DesktopFeedEntry[]): readonly AptPackage[] => {
  const packages = entries.flatMap((entry): AptPackage[] => {
    const control =
      entry.artifactFormat === "deb"
        ? readDesktopBuildMetadata("linux", entry.metadataJson)?.debControl
        : undefined;
    const parsed = control === undefined ? undefined : parseControl(control);
    return parsed === undefined ? [] : [{ ...parsed, entry }];
  });
  return packages.filter(
    (pkg, index) => packages.findIndex((other) => packageKey(other) === packageKey(pkg)) === index,
  );
};

/** Where a deb is, relative to the repository's base: what a stanza's `Filename` says. */
export const aptPoolPath = (entry: DesktopFeedEntry): string =>
  `pool/${entry.id}/${feedFileName(entry)}`;

const POOL_ROUTE = /^pool\/(?<releaseId>[^/]+)\/(?<file>[^/]+\.deb)$/u;

/** A pool path's release id and file name, or undefined when it is not one. */
export const parseAptPoolPath = (
  path: string,
): { readonly releaseId: string; readonly file: string } | undefined => {
  const groups = POOL_ROUTE.exec(path)?.groups;
  const releaseId = groups?.["releaseId"];
  const file = groups?.["file"];
  return releaseId === undefined || file === undefined ? undefined : { releaseId, file };
};

const stanza = (pkg: AptPackage): string =>
  [
    ...pkg.fields.filter(([name]) => !REPOSITORY_FIELDS.has(name.toLowerCase())),
    ...(pkg.entry.rolloutPercentage < 100
      ? [["Phased-Update-Percentage", String(pkg.entry.rolloutPercentage)] as const]
      : []),
    ["Filename", aptPoolPath(pkg.entry)] as const,
    ["Size", String(pkg.entry.byteSize)] as const,
    ["SHA256", pkg.entry.sha256.toLowerCase()] as const,
    ["SHA512", toHex(fromBase64(pkg.entry.sha512))] as const,
  ]
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

/** One architecture's `Packages` index: its debs and the architecture-independent ones. */
export const renderPackages = (
  packages: readonly AptPackage[],
  architecture: AptArchitecture,
): string =>
  packages
    .filter((pkg) => pkg.architecture === architecture || pkg.architecture === "all")
    .map((pkg) => `${stanza(pkg)}\n`)
    .join("\n");

/** An index file a Release lists, relative to the suite's directory. */
export interface AptIndexFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

/** The index files of a suite, relative to `dists/<channel>/`. */
export const aptIndexPath = (architecture: AptArchitecture): string =>
  `${APT_COMPONENT}/binary-${architecture}/Packages`;

const INDEX_ROUTE = new RegExp(
  `^${APT_COMPONENT}/binary-(?<arch>[a-z0-9]+)/(?:Packages|by-hash/SHA256/(?<digest>[a-f0-9]{64}))$`,
  "u",
);

/** What a request under `dists/<channel>/` names: an architecture's index, maybe by digest. */
export const parseAptIndexPath = (
  path: string,
): { readonly architecture: AptArchitecture; readonly digest: string | undefined } | undefined => {
  const groups = INDEX_ROUTE.exec(path)?.groups;
  const architecture = APT_ARCHITECTURES.find((arch) => arch === groups?.["arch"]);
  return architecture === undefined ? undefined : { architecture, digest: groups?.["digest"] };
};

/** RFC 2822 in UTC, as Debian's archive writes `Date`. */
export const aptDate = (date: Date): string => date.toUTCString().replace(/GMT$/u, "UTC");

/**
 * A suite's Release file: the channel as both suite and codename, every
 * architecture, and each index's size and SHA-256. `Acquire-By-Hash` lets
 * apt fetch the exact indexes this Release names even after a new release
 * changes them.
 */
export const renderRelease = (params: {
  readonly label: string;
  readonly channel: string;
  readonly date: Date;
  readonly files: readonly AptIndexFile[];
}): string =>
  [
    `Origin: ${params.label}`,
    `Label: ${params.label}`,
    `Suite: ${params.channel}`,
    `Codename: ${params.channel}`,
    `Date: ${aptDate(params.date)}`,
    `Architectures: ${APT_ARCHITECTURES.join(" ")}`,
    `Components: ${APT_COMPONENT}`,
    "Acquire-By-Hash: yes",
    "SHA256:",
    ...params.files.map(
      (file) => ` ${file.sha256} ${String(file.size).padStart(16, " ")} ${file.path}`,
    ),
    "",
  ].join("\n");
