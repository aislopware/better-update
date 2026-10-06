/**
 * Tauri updater JSON (tauri-plugin-updater 2.10+), rendered from stored
 * release rows. Pure.
 *
 * Tauri installs a signed `.app.tar.gz` on a Mac, an NSIS `.exe` or `.msi` on
 * Windows, and an `.AppImage`, `.deb` or `.rpm` on Linux. The static form
 * keys each download `{os}-{arch}-{installer}` — the updater tries that
 * first — and `{os}-{arch}` for one that does not know how it was installed
 * (before Tauri 2.9) with the platform's preferred installer. The dynamic form
 * answers one target, architecture and (optionally) bundle type. 204 is "no
 * update".
 */
import type { DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

import { entryArchitectures } from "./desktop-feed-files";

import type { DesktopFeedEntry } from "../desktop-release-models";
import type { DownloadUrl } from "./desktop-feed-files";

/** Tauri's feed file for a channel. */
export const TAURI_FEED_FILE = /^(?<channel>[a-z0-9][a-z0-9._-]{0,39})-tauri\.json$/u;

/** The cross-platform feed file for a channel (`/feeds/<projectId>/tauri/<channel>.json`). */
export const TAURI_CHANNEL_FILE = /^(?<channel>[a-z0-9][a-z0-9._-]{0,39})\.json$/u;

/** `{{arch}}` as the Tauri updater fills it in. */
export const TAURI_ARCHES = ["x86_64", "aarch64", "i686", "armv7"] as const;
export type TauriArch = (typeof TAURI_ARCHES)[number];

export const isTauriArch = (value: string | null): value is TauriArch =>
  TAURI_ARCHES.some((arch) => arch === value);

/** `{{target}}` as the Tauri updater fills it in. */
const TAURI_OS = { macos: "darwin", windows: "windows", linux: "linux" } as const;

const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = ["macos", "windows", "linux"];

export const tauriTargetPlatform = (target: string | null): DesktopPlatform | undefined =>
  DESKTOP_PLATFORMS.find((platform) => TAURI_OS[platform] === target);

/** `{{bundle_type}}`: how the running app was installed. */
const TAURI_INSTALLER: Partial<Record<DesktopArtifactFormat, string>> = {
  "tar.gz": "app",
  exe: "nsis",
  msi: "msi",
  appimage: "appimage",
  deb: "deb",
  rpm: "rpm",
};

/** The installer an `{os}-{arch}` key points at when several are released. */
const INSTALLER_PREFERENCE: Readonly<Record<DesktopPlatform, readonly string[]>> = {
  macos: ["app"],
  windows: ["nsis", "msi"],
  linux: ["appimage", "deb", "rpm"],
};

const DESKTOP_TO_TAURI_ARCH = {
  x64: "x86_64",
  arm64: "aarch64",
  ia32: "i686",
  armv7l: "armv7",
} as const satisfies Record<string, TauriArch>;

/** Tauri reads `version` as semver; a leading `v` is allowed. */
const SEMVER =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

interface TauriInstallable {
  readonly entry: DesktopFeedEntry;
  readonly version: string;
  readonly signature: string;
  readonly installer: string;
}

/** What the Tauri updater can install: a signed artifact of its formats with a semver version. */
const tauriInstallable = (entries: readonly DesktopFeedEntry[]): readonly TauriInstallable[] =>
  entries.flatMap((entry) => {
    const installer = TAURI_INSTALLER[entry.artifactFormat];
    return installer !== undefined &&
      entry.tauriSignature !== null &&
      entry.appVersion !== null &&
      SEMVER.test(entry.appVersion)
      ? [{ entry, version: entry.appVersion, signature: entry.tauriSignature, installer }]
      : [];
  });

/**
 * The machines a build runs on. A Mac build that names no single architecture
 * is universal; a Windows or Linux one that names none is x64.
 */
const tauriArches = (entry: DesktopFeedEntry): readonly TauriArch[] => {
  const architectures = entryArchitectures(entry);
  if (entry.platform === "macos" && architectures.length !== 1) {
    return ["x86_64", "aarch64"];
  }
  return architectures.length === 0
    ? ["x86_64"]
    : architectures.map((arch) => DESKTOP_TO_TAURI_ARCH[arch]);
};

const tauriCommon = (item: TauriInstallable) => ({
  version: item.version,
  ...(item.entry.releaseNotes === null ? {} : { notes: item.entry.releaseNotes }),
  pub_date: item.entry.createdAt,
});

const tauriPlatform = (item: TauriInstallable, downloadUrl: DownloadUrl) => ({
  url: downloadUrl(item.entry),
  signature: item.signature,
});

const preferenceRank = (item: TauriInstallable): number =>
  INSTALLER_PREFERENCE[item.entry.platform].indexOf(item.installer);

/**
 * Tauri's static form: the newest installable version, with a key per
 * `{os}-{arch}-{installer}` that version covers (a universal Mac build fills
 * both Mac architectures) and per `{os}-{arch}` for its preferred installer.
 * Undefined when nothing is installable — the endpoint answers 204.
 */
export const renderTauriStatic = (
  entries: readonly DesktopFeedEntry[],
  downloadUrl: DownloadUrl,
): string | undefined => {
  const installable = tauriInstallable(entries);
  const [newest] = installable;
  if (newest === undefined) {
    return undefined;
  }
  const keyed = installable
    .filter((item) => item.version === newest.version)
    .toSorted((left, right) => preferenceRank(left) - preferenceRank(right))
    .flatMap((item) =>
      tauriArches(item.entry).flatMap((arch) => {
        const target = `${TAURI_OS[item.entry.platform]}-${arch}`;
        return [
          [`${target}-${item.installer}`, item],
          [target, item],
        ] as const;
      }),
    );
  // The first item per key wins: newest first within the preferred installer.
  const platforms = Object.fromEntries(
    keyed
      .filter(([key], index) => keyed.findIndex(([other]) => other === key) === index)
      .map(([key, item]) => [key, tauriPlatform(item, downloadUrl)]),
  );
  return JSON.stringify({ ...tauriCommon(newest), platforms });
};

/**
 * Tauri's dynamic form for an endpoint templated with `{{arch}}` (and
 * optionally `{{bundle_type}}`): the newest installable release that runs on
 * `arch`, in the app's installer when it names one Tauri knows, else in the
 * platform's preferred installer. Undefined (204, no update) when none.
 */
export const renderTauriDynamic = (
  entries: readonly DesktopFeedEntry[],
  request: { readonly arch: TauriArch; readonly bundleType?: string | undefined },
  downloadUrl: DownloadUrl,
): string | undefined => {
  const forArch = tauriInstallable(entries).filter((item) =>
    tauriArches(item.entry).includes(request.arch),
  );
  // An app that knows its installer only takes that installer: Tauri would
  // otherwise unpack, say, an AppImage over a deb-installed binary.
  const knownInstaller = Object.values(TAURI_INSTALLER).some(
    (installer) => installer === request.bundleType,
  );
  const candidates = knownInstaller
    ? forArch.filter((item) => item.installer === request.bundleType)
    : forArch;
  const [newest] = candidates;
  if (newest === undefined) {
    return undefined;
  }
  const [item = newest] = candidates
    .filter((candidate) => candidate.version === newest.version)
    .toSorted((left, right) => preferenceRank(left) - preferenceRank(right));
  return JSON.stringify({ ...tauriCommon(item), ...tauriPlatform(item, downloadUrl) });
};
