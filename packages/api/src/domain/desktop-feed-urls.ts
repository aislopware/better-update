import { DEFAULT_DESKTOP_CHANNEL } from "./desktop-release";

import type { DesktopPlatform } from "./build";
import type { DesktopRelease } from "./desktop-release";

export interface DesktopFeedUrl {
  readonly label: string;
  readonly url: string;
}

type FeedRelease = Pick<
  DesktopRelease,
  "artifactFormat" | "sparkleSigned" | "tauriSigned" | "winSparkleSigned"
>;

const ELECTRON_FILE: Readonly<Record<DesktopPlatform, (channel: string) => string>> = {
  macos: (channel) => `${channel}-mac.yml`,
  windows: (channel) => `${channel}.yml`,
  linux: (channel) => `${channel}-linux.yml`,
};

/** The formats electron-updater installs on each platform. */
const ELECTRON_FORMATS: Readonly<Record<DesktopPlatform, readonly string[]>> = {
  macos: ["zip"],
  windows: ["exe"],
  linux: ["appimage", "deb", "rpm"],
};

const channelQuery = (channel: string, separator: "?" | "&") =>
  channel === DEFAULT_DESKTOP_CHANNEL ? "" : `${separator}channel=${channel}`;

/**
 * The URLs an app on `platform` polls for one channel, limited to the
 * updaters the channel's releases serve: a Sparkle or WinSparkle appcast, an
 * electron-updater channel file (on Linux, `-arm64` and the like before
 * `.yml` for other architectures), the Tauri endpoint, and the first-install
 * download link. Shared by the CLI and the dashboard so both name the same URLs.
 */
export const desktopFeedUrls = (params: {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly platform: DesktopPlatform;
  readonly channel: string;
  readonly releases: readonly FeedRelease[];
}): readonly DesktopFeedUrl[] => {
  const { baseUrl, projectId, platform, channel, releases } = params;
  const feedBase = `${baseUrl}/feeds/${projectId}/${platform}`;
  const any = (keep: (release: FeedRelease) => boolean) => releases.some(keep);
  const appcast =
    platform === "macos"
      ? any((release) => release.artifactFormat !== "tar.gz") && {
          label: "Sparkle appcast",
          url: `${feedBase}/appcast.xml`,
        }
      : platform === "windows" &&
        any((release) => release.winSparkleSigned) && {
          label: "WinSparkle appcast",
          url: `${feedBase}/appcast.xml${channelQuery(channel, "?")}`,
        };
  const electron = any((release) =>
    ELECTRON_FORMATS[platform].includes(release.artifactFormat),
  ) && {
    label: "electron-updater",
    url: `${feedBase}/${ELECTRON_FILE[platform](channel)}`,
  };
  const tauri = any((release) => release.tauriSigned) && {
    label: "Tauri updater",
    url: `${baseUrl}/feeds/${projectId}/tauri/${channel}.json?target={{target}}&arch={{arch}}&bundle_type={{bundle_type}}`,
  };
  const download = {
    label: "First-install download",
    url: `${feedBase}/latest/download${channelQuery(channel, "?")}`,
  };
  return [appcast, electron, tauri, download].filter(
    (entry): entry is DesktopFeedUrl => entry !== false,
  );
};
