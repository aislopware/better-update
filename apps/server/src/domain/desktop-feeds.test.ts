import {
  artifactBlockmapKey,
  blockmapVersionOf,
  darwinVersionOf,
  feedDeltaPath,
  feedFileName,
  renderBlockmap,
  windowsReleaseVersionOf,
} from "./desktop-feed-files";
import { renderAppcast, renderWinSparkleAppcast } from "./desktop-feeds-appcast";
import {
  parseElectronFeedFile,
  pickElectronRelease,
  renderElectronYml,
} from "./desktop-feeds-electron";
import { renderTauriDynamic, renderTauriStatic, TAURI_FEED_FILE } from "./desktop-feeds-tauri";
import { pickLatestDownload, renderReleaseIndex } from "./desktop-release-index";

import type { DesktopFeedEntry, SparkleDeltaModel } from "../desktop-release-models";

const SHA512 = `${"A".repeat(86)}==`;
const SIGNATURE = `${"B".repeat(86)}==`;

const withArchitectures = (architectures: readonly string[]) =>
  JSON.stringify({ macos: { appName: "Example Desktop", architectures } });

const entry = (overrides: Partial<DesktopFeedEntry> = {}): DesktopFeedEntry => ({
  id: "0190f0aa-0000-7000-8000-000000000001",
  organizationId: "org-1",
  projectId: "project-1",
  buildId: "build-1",
  platform: "macos",
  channel: "latest",
  appVersion: "1.4.0",
  buildNumber: "140",
  artifactFormat: "dmg",
  releaseNotes: null,
  critical: false,
  rolloutPercentage: 100,
  phasedRolloutHours: null,
  halted: false,
  sha512: SHA512,
  sparkleEdSignature: SIGNATURE,
  winSparkleEdSignature: null,
  tauriSignature: null,
  blockmap: false,
  sparkleDeltas: 0,
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  bundleId: "com.example.desktop",
  metadataJson: JSON.stringify({
    macos: {
      appName: "Example Desktop",
      minimumSystemVersion: "13.0",
      notarization: { status: "accepted", stapled: true },
    },
  }),
  byteSize: 1234,
  r2Key: "builds/example",
  ...overrides,
});

describe(feedFileName, () => {
  it("names the download after the app and version", () => {
    expect(feedFileName(entry())).toBe("Example-Desktop-1.4.0.dmg");
  });

  it("names a single-architecture build for electron-updater's arch matching", () => {
    expect(feedFileName(entry({ metadataJson: withArchitectures(["arm64"]) }))).toBe(
      "Example-Desktop-1.4.0-arm64.dmg",
    );
    expect(feedFileName(entry({ metadataJson: withArchitectures(["x86_64"]) }))).toBe(
      "Example-Desktop-1.4.0-x64.dmg",
    );
    expect(feedFileName(entry({ metadataJson: withArchitectures(["arm64", "x86_64"]) }))).toBe(
      "Example-Desktop-1.4.0.dmg",
    );
  });

  it("falls back to the bundle id's last component without an app name", () => {
    expect(feedFileName(entry({ metadataJson: "{}", artifactFormat: "zip" }))).toBe(
      "desktop-1.4.0.zip",
    );
  });
});

const BASE = "https://updates.example.com/feeds/project-1/";

/** The handler's absolute download URL, under each release's platform directory. */
const downloadUrl = (release: DesktopFeedEntry) =>
  `${BASE}${release.platform}/download/${release.id}/${feedFileName(release)}`;

describe(renderAppcast, () => {
  const base = `${BASE}macos/`;

  it("renders a Sparkle item with versions, minimum OS, signature and download URL", () => {
    const xml = renderAppcast({ title: "Updates", downloadUrl, entries: [entry()] });
    expect(xml).toContain("<sparkle:version>140</sparkle:version>");
    expect(xml).toContain("<sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>");
    expect(xml).toContain("<sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>");
    expect(xml).toContain("<pubDate>Mon, 05 Oct 2026 10:00:00 +0000</pubDate>");
    expect(xml).toContain(
      `<enclosure url="${base}download/0190f0aa-0000-7000-8000-000000000001/Example-Desktop-1.4.0.dmg" length="1234" type="application/octet-stream" sparkle:edSignature="${SIGNATURE}"/>`,
    );
    // The default channel is what every client sees: no channel tag.
    expect(xml).not.toContain("sparkle:channel");
  });

  it("tags other channels, marks critical updates and escapes release notes", () => {
    const xml = renderAppcast({
      title: "Updates",
      downloadUrl,
      entries: [
        entry({
          channel: "beta",
          critical: true,
          releaseNotes: "Fixes <crash>\n\nFaster & smaller",
          sparkleEdSignature: null,
        }),
      ],
    });
    expect(xml).toContain("<sparkle:channel>beta</sparkle:channel>");
    expect(xml).toContain("<sparkle:criticalUpdate></sparkle:criticalUpdate>");
    expect(xml).toContain(
      "<description><![CDATA[<p>Fixes &lt;crash&gt;</p><p>Faster &amp; smaller</p>]]></description>",
    );
    expect(xml).not.toContain("edSignature");
  });

  it("requires Apple silicon for an arm64-only build and phases by the hour", () => {
    const xml = renderAppcast({
      title: "Updates",
      downloadUrl,
      entries: [entry({ metadataJson: withArchitectures(["arm64"]), phasedRolloutHours: 24 })],
    });
    expect(xml).toContain("<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>");
    expect(xml).toContain("<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>");
  });

  const delta = (overrides: Partial<SparkleDeltaModel> = {}): SparkleDeltaModel => ({
    id: "delta-1",
    buildId: "build-1",
    deltaFrom: "130",
    r2Key: "builds/example.delta-1",
    byteSize: 321,
    sha256: "c".repeat(64),
    edSignature: SIGNATURE,
    sparkleExecutableSize: 2_048_000,
    sparkleLocales: "de,fr",
    createdAt: "2026-10-05T10:00:00.000Z",
    ...overrides,
  });
  const deltaUrl = (release: DesktopFeedEntry, patch: SparkleDeltaModel) =>
    `${base}${feedDeltaPath(release, patch)}`;

  it("lists a build's deltas under its item, signed and named like generate_appcast's", () => {
    const xml = renderAppcast({
      title: "Updates",
      downloadUrl,
      entries: [entry(), entry({ id: "older", buildId: "build-0", buildNumber: "130" })],
      deltas: {
        byBuild: new Map([
          [
            "build-1",
            [
              delta(),
              delta({
                id: "delta-2",
                deltaFrom: "120",
                sparkleExecutableSize: null,
                sparkleLocales: null,
              }),
            ],
          ],
        ]),
        url: deltaUrl,
      },
    });
    expect(xml).toContain(
      [
        "      <sparkle:deltas>",
        `        <enclosure url="${base}delta/0190f0aa-0000-7000-8000-000000000001/delta-1/Example-Desktop140-130.delta" sparkle:deltaFrom="130" length="321" type="application/octet-stream" sparkle:deltaFromSparkleExecutableSize="2048000" sparkle:deltaFromSparkleLocales="de,fr" sparkle:edSignature="${SIGNATURE}"/>`,
        `        <enclosure url="${base}delta/0190f0aa-0000-7000-8000-000000000001/delta-2/Example-Desktop140-120.delta" sparkle:deltaFrom="120" length="321" type="application/octet-stream" sparkle:edSignature="${SIGNATURE}"/>`,
        "      </sparkle:deltas>",
        "    </item>",
      ].join("\n"),
    );
    // Only the build the deltas patch to lists them.
    expect(xml.match(/<sparkle:deltas>/gu)).toHaveLength(1);
  });

  it("drops a delta from the item's own version", () => {
    const xml = renderAppcast({
      title: "Updates",
      downloadUrl,
      entries: [entry()],
      deltas: { byBuild: new Map([["build-1", [delta({ deltaFrom: "140" })]]]), url: deltaUrl },
    });
    expect(xml).not.toContain("sparkle:deltas");
  });

  it("leaves universal and Intel builds to every Mac and unphased releases to every client", () => {
    const xml = renderAppcast({
      title: "Updates",
      downloadUrl,
      entries: [
        entry({ metadataJson: withArchitectures(["arm64", "x86_64"]) }),
        entry({ metadataJson: withArchitectures(["x86_64"]) }),
      ],
    });
    expect(xml).not.toContain("hardwareRequirements");
    expect(xml).not.toContain("phasedRolloutInterval");
  });
});

const MAC_ZIP = { formats: ["zip"] } as const;

describe(pickElectronRelease, () => {
  it("takes the newest zip with a version and skips other containers", () => {
    const zip = entry({ id: "zip-release", artifactFormat: "zip" });
    expect(
      pickElectronRelease(
        [entry({ artifactFormat: "dmg" }), zip, entry({ artifactFormat: "zip" })],
        MAC_ZIP,
      ),
    ).toStrictEqual({ version: "1.4.0", files: [zip] });
  });

  it("pairs the newest version's arm64-only zip with its newest other zip", () => {
    const arm = entry({
      id: "arm",
      artifactFormat: "zip",
      metadataJson: withArchitectures(["arm64"]),
    });
    const intel = entry({
      id: "intel",
      artifactFormat: "zip",
      metadataJson: withArchitectures(["x86_64"]),
    });
    const olderIntel = entry({
      id: "older-intel",
      artifactFormat: "zip",
      metadataJson: withArchitectures(["x86_64"]),
    });
    const previous = entry({ id: "previous", artifactFormat: "zip", appVersion: "1.3.0" });
    expect(pickElectronRelease([arm, intel, olderIntel, previous], MAC_ZIP)).toStrictEqual({
      version: "1.4.0",
      files: [arm, intel],
    });
  });

  it("skips a newer zip without a version", () => {
    const zip = entry({ id: "versioned", artifactFormat: "zip" });
    expect(
      pickElectronRelease([entry({ artifactFormat: "zip", appVersion: null }), zip], MAC_ZIP),
    ).toStrictEqual({ version: "1.4.0", files: [zip] });
  });

  it("has nothing without a versioned zip", () => {
    expect(
      pickElectronRelease([entry({ artifactFormat: "zip", appVersion: null })], MAC_ZIP),
    ).toBeUndefined();
  });
});

describe(renderElectronYml, () => {
  it("renders latest-mac.yml with a relative download and staging percentage", () => {
    const yml = renderElectronYml({
      version: "1.4.0",
      files: [
        entry({ id: "rel-1", artifactFormat: "zip", rolloutPercentage: 25, releaseNotes: 'a "b"' }),
      ],
    });
    expect(yml).toBe(
      [
        'version: "1.4.0"',
        "files:",
        '  - url: "download/rel-1/Example-Desktop-1.4.0.zip"',
        `    sha512: "${SHA512}"`,
        "    size: 1234",
        'path: "download/rel-1/Example-Desktop-1.4.0.zip"',
        `sha512: "${SHA512}"`,
        'releaseDate: "2026-10-05T10:00:00.000Z"',
        String.raw`releaseNotes: "a \"b\""`,
        // macOS 13 is Darwin 22: what os.release() reports there.
        'minimumSystemVersion: "22.0.0"',
        "stagingPercentage: 25",
        "",
      ].join("\n"),
    );
  });

  it("lists one file per architecture, the newest first at the top level", () => {
    const yml = renderElectronYml({
      version: "1.4.0",
      files: [
        entry({ id: "arm", artifactFormat: "zip", metadataJson: withArchitectures(["arm64"]) }),
        entry({ id: "intel", artifactFormat: "zip", metadataJson: withArchitectures(["x86_64"]) }),
      ],
    });
    expect(yml).toContain(
      [
        "files:",
        '  - url: "download/arm/Example-Desktop-1.4.0-arm64.zip"',
        `    sha512: "${SHA512}"`,
        "    size: 1234",
        '  - url: "download/intel/Example-Desktop-1.4.0-x64.zip"',
        `    sha512: "${SHA512}"`,
        "    size: 1234",
        'path: "download/arm/Example-Desktop-1.4.0-arm64.zip"',
      ].join("\n"),
    );
  });

  it("matches only the platform's channel file names", () => {
    expect(parseElectronFeedFile("macos", "beta-mac.yml")).toStrictEqual({
      channel: "beta",
      formats: ["zip"],
    });
    expect(parseElectronFeedFile("macos", "../x-mac.yml")).toBeUndefined();
    expect(parseElectronFeedFile("macos", "latest.yml")).toBeUndefined();
  });
});

describe(renderTauriStatic, () => {
  const base = `${BASE}macos/`;
  const tarball = (overrides: Partial<DesktopFeedEntry> = {}) =>
    entry({ artifactFormat: "tar.gz", tauriSignature: "VEFVUkk=", ...overrides });

  it("names a Tauri archive the way Tauri's bundler does", () => {
    expect(feedFileName(tarball())).toBe("Example-Desktop-1.4.0.app.tar.gz");
  });

  it("serves a universal build under both Mac architectures", () => {
    const json: unknown = JSON.parse(
      renderTauriStatic([tarball({ id: "rel-u", releaseNotes: "Notes" })], downloadUrl) ?? "null",
    );
    const platform = {
      url: `${base}download/rel-u/Example-Desktop-1.4.0.app.tar.gz`,
      signature: "VEFVUkk=",
    };
    expect(json).toStrictEqual({
      version: "1.4.0",
      notes: "Notes",
      pub_date: "2026-10-05T10:00:00.000Z",
      platforms: {
        "darwin-x86_64-app": platform,
        "darwin-x86_64": platform,
        "darwin-aarch64-app": platform,
        "darwin-aarch64": platform,
      },
    });
  });

  it("pairs the newest version's per-architecture builds and skips what Tauri cannot install", () => {
    const arm = tarball({ id: "arm", metadataJson: withArchitectures(["arm64"]) });
    const intel = tarball({ id: "intel", metadataJson: withArchitectures(["x86_64"]) });
    const json = JSON.parse(
      renderTauriStatic(
        [
          tarball({ id: "unsigned", appVersion: "2.0.0", tauriSignature: null }),
          tarball({ id: "not-semver", appVersion: "2.0" }),
          entry({ id: "dmg", appVersion: "2.0.0" }),
          arm,
          intel,
          tarball({ id: "older", appVersion: "1.3.0" }),
        ],
        downloadUrl,
      ) ?? "null",
    ) as { readonly version: string; readonly platforms: Record<string, { url: string }> };
    expect(json.version).toBe("1.4.0");
    expect(json.platforms["darwin-aarch64"]?.url).toContain("download/arm/");
    expect(json.platforms["darwin-x86_64"]?.url).toContain("download/intel/");
  });

  it("has nothing to offer without a signed archive", () => {
    expect(
      renderTauriStatic([entry(), tarball({ tauriSignature: null })], downloadUrl),
    ).toBeUndefined();
  });
});

describe(renderTauriDynamic, () => {
  const base = `${BASE}macos/`;

  it("answers one architecture with the newest release that runs on it", () => {
    const arm = entry({
      id: "arm",
      artifactFormat: "tar.gz",
      tauriSignature: "QVJN",
      appVersion: "2.0.0",
      metadataJson: withArchitectures(["arm64"]),
    });
    const intel = entry({
      id: "intel",
      artifactFormat: "tar.gz",
      tauriSignature: "SU5URUw=",
      metadataJson: withArchitectures(["x86_64"]),
    });
    expect(
      JSON.parse(renderTauriDynamic([arm, intel], { arch: "x86_64" }, downloadUrl) ?? "null"),
    ).toStrictEqual({
      version: "1.4.0",
      pub_date: "2026-10-05T10:00:00.000Z",
      url: `${base}download/intel/Example-Desktop-1.4.0-x64.app.tar.gz`,
      signature: "SU5URUw=",
    });
    expect(renderTauriDynamic([arm], { arch: "x86_64" }, downloadUrl)).toBeUndefined();
  });

  it("matches only channel feed file names", () => {
    expect(TAURI_FEED_FILE.exec("latest-tauri.json")?.groups?.["channel"]).toBe("latest");
    expect(TAURI_FEED_FILE.exec("latest-mac.yml")).toBeNull();
  });
});

describe("electron-updater blockmaps", () => {
  const arm64Zip = entry({ artifactFormat: "zip", metadataJson: withArchitectures(["arm64"]) });

  it("is stored next to the artifact", () => {
    expect(artifactBlockmapKey("builds/org/project/build.zip")).toBe(
      "builds/org/project/build.zip.blockmap",
    );
  });

  it("reads the version electron-updater put into the new file's name", () => {
    expect(blockmapVersionOf(arm64Zip, "Example-Desktop-1.3.2-arm64.zip")).toBe("1.3.2");
    expect(blockmapVersionOf(arm64Zip, "Example-Desktop-1.4.0-arm64.zip")).toBe("1.4.0");
  });

  it("names no version for another app, architecture or format", () => {
    expect(blockmapVersionOf(arm64Zip, "Other-App-1.3.2-arm64.zip")).toBeUndefined();
    expect(blockmapVersionOf(arm64Zip, "Example-Desktop-1.3.2.zip")).toBeUndefined();
    expect(blockmapVersionOf(arm64Zip, "Example-Desktop-1.3.2-arm64.dmg")).toBeUndefined();
    expect(blockmapVersionOf(arm64Zip, "Example-Desktop--arm64.zip")).toBeUndefined();
  });

  it("renders the whole archive as electron-updater's single `file`", () => {
    expect(
      JSON.parse(renderBlockmap({ checksums: ["AAAA", "BBBB"], sizes: [10, 4] })),
    ).toStrictEqual({
      version: "2",
      files: [{ name: "file", offset: 0, checksums: ["AAAA", "BBBB"], sizes: [10, 4] }],
    });
  });
});

const desktopMetadata = (
  platform: "windows" | "linux",
  fields: Record<string, unknown> = {},
): string => JSON.stringify({ [platform]: { appName: "Example Desktop", ...fields } });

const windowsEntry = (overrides: Partial<DesktopFeedEntry> = {}, fields = {}) =>
  entry({
    platform: "windows",
    artifactFormat: "exe",
    sparkleEdSignature: null,
    metadataJson: desktopMetadata("windows", { architectures: ["x64"], ...fields }),
    ...overrides,
  });

const linuxEntry = (overrides: Partial<DesktopFeedEntry> = {}, fields = {}) =>
  entry({
    platform: "linux",
    artifactFormat: "appimage",
    sparkleEdSignature: null,
    metadataJson: desktopMetadata("linux", { architectures: ["x64"], ...fields }),
    ...overrides,
  });

describe("Windows and Linux file names", () => {
  it("follows electron-builder's naming, with the architecture electron-updater matches", () => {
    expect(feedFileName(windowsEntry())).toBe("Example-Desktop-Setup-1.4.0-x64.exe");
    expect(feedFileName(windowsEntry({}, { architectures: ["arm64"] }))).toBe(
      "Example-Desktop-Setup-1.4.0-arm64.exe",
    );
    expect(feedFileName(windowsEntry({}, { architectures: ["x64", "arm64"] }))).toBe(
      "Example-Desktop-Setup-1.4.0.exe",
    );
    expect(feedFileName(windowsEntry({ artifactFormat: "msi" }))).toBe(
      "Example-Desktop-1.4.0-x64.msi",
    );
  });

  it("names Linux packages the way their tools do", () => {
    expect(feedFileName(linuxEntry())).toBe("Example-Desktop-1.4.0.AppImage");
    expect(feedFileName(linuxEntry({}, { architectures: ["arm64"] }))).toBe(
      "Example-Desktop-1.4.0-arm64.AppImage",
    );
    expect(
      feedFileName(linuxEntry({ artifactFormat: "deb" }, { packageName: "example-desktop" })),
    ).toBe("example-desktop_1.4.0_amd64.deb");
    expect(
      feedFileName(
        linuxEntry(
          { artifactFormat: "rpm" },
          { packageName: "example-desktop", architectures: ["arm64"] },
        ),
      ),
    ).toBe("example-desktop-1.4.0.aarch64.rpm");
  });

  it("finds the old version in an NSIS installer's blockmap URL", () => {
    expect(blockmapVersionOf(windowsEntry(), "Example-Desktop-Setup-1.3.0-x64.exe")).toBe("1.3.0");
    expect(
      blockmapVersionOf(windowsEntry(), "Example-Desktop-Setup-1.3.0-arm64.exe"),
    ).toBeUndefined();
  });
});

describe(darwinVersionOf, () => {
  it("maps a macOS version to the Darwin release it reports, never above it", () => {
    expect(darwinVersionOf("10.15")).toBe("19.0.0");
    expect(darwinVersionOf("11.0")).toBe("20.0.0");
    expect(darwinVersionOf("13.4")).toBe("22.0.0");
    expect(darwinVersionOf("15")).toBe("24.0.0");
    // macOS 26.4 reports Darwin 25.4 and 27.0 reports Darwin 27.0.
    expect(darwinVersionOf("26.0")).toBe("25.0.0");
    expect(darwinVersionOf("27.0")).toBe("26.0.0");
    expect(darwinVersionOf("ten")).toBeUndefined();
  });

  it("pads a Windows version to the semver os.release() is compared as", () => {
    expect(windowsReleaseVersionOf("10.0.17763")).toBe("10.0.17763");
    expect(windowsReleaseVersionOf("10.0")).toBe("10.0.0");
    expect(windowsReleaseVersionOf("Windows 10")).toBeUndefined();
  });
});

describe("electron-updater on Windows and Linux", () => {
  it("reads each platform's channel file names", () => {
    expect(parseElectronFeedFile("windows", "latest.yml")).toStrictEqual({
      channel: "latest",
      formats: ["exe"],
    });
    expect(parseElectronFeedFile("linux", "latest-linux.yml")).toStrictEqual({
      channel: "latest",
      formats: ["appimage", "deb", "rpm"],
      arch: "x64",
    });
    expect(parseElectronFeedFile("linux", "beta-linux-arm64.yml")?.arch).toBe("arm64");
    expect(parseElectronFeedFile("linux", "latest-linux-arm.yml")?.arch).toBe("armv7l");
    expect(parseElectronFeedFile("linux", "latest.yml")).toBeUndefined();
  });

  it("lists one NSIS installer per architecture, never an MSI", () => {
    const x64 = windowsEntry({ id: "x64" });
    const arm = windowsEntry({ id: "arm" }, { architectures: ["arm64"] });
    const msi = windowsEntry({ id: "msi", artifactFormat: "msi" });
    const picked = pickElectronRelease([msi, x64, arm], { formats: ["exe"] });
    expect(picked?.files.map((file) => file.id)).toStrictEqual(["x64", "arm"]);
  });

  it("writes the Windows minimum as the release version electron-updater compares", () => {
    const yml = renderElectronYml({
      version: "1.4.0",
      files: [windowsEntry({ id: "w" }, { minimumSystemVersion: "10.0.17763" })],
    });
    expect(yml).toContain('  - url: "download/w/Example-Desktop-Setup-1.4.0-x64.exe"');
    expect(yml).toContain('minimumSystemVersion: "10.0.17763"');
  });

  it("serves one architecture per Linux file, every package type, and the AppImage's blockmap size", () => {
    const appImage = linuxEntry({ id: "appimage" }, { blockMapSize: 9876 });
    const deb = linuxEntry({ id: "deb", artifactFormat: "deb" });
    const arm = linuxEntry({ id: "arm" }, { architectures: ["arm64"] });
    const x64 = pickElectronRelease([arm, appImage, deb], {
      formats: ["appimage", "deb", "rpm"],
      arch: "x64",
    });
    expect(x64?.files.map((file) => file.id)).toStrictEqual(["appimage", "deb"]);
    const yml = renderElectronYml(x64 ?? { version: "", files: [appImage] });
    expect(yml).toContain("    blockMapSize: 9876");
    expect(yml).not.toContain("minimumSystemVersion");
    const arm64 = pickElectronRelease([arm, appImage, deb], {
      formats: ["appimage", "deb", "rpm"],
      arch: "arm64",
    });
    expect(arm64?.files.map((file) => file.id)).toStrictEqual(["arm"]);
  });
});

describe("Tauri on Windows and Linux", () => {
  const signed = { tauriSignature: "U0lH" } as const;

  it("keys every installer and points the plain key at the preferred one", () => {
    const nsis = windowsEntry({ id: "nsis", ...signed });
    const msi = windowsEntry({ id: "msi", artifactFormat: "msi", ...signed });
    const deb = linuxEntry(
      { id: "deb", artifactFormat: "deb", ...signed },
      { architectures: ["arm64"] },
    );
    const json = JSON.parse(renderTauriStatic([msi, nsis, deb], downloadUrl) ?? "null") as {
      readonly platforms: Record<string, { readonly url: string }>;
    };
    expect(Object.keys(json.platforms).toSorted()).toStrictEqual([
      "linux-aarch64",
      "linux-aarch64-deb",
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
    expect(json.platforms["windows-x86_64"]?.url).toContain("/windows/download/nsis/");
    expect(json.platforms["windows-x86_64-msi"]?.url).toContain("/windows/download/msi/");
  });

  it("answers an app that knows its installer only with that installer", () => {
    const appImage = linuxEntry({ id: "appimage", appVersion: "2.0.0", ...signed });
    const deb = linuxEntry({ id: "deb", artifactFormat: "deb", ...signed });
    const forDeb = JSON.parse(
      renderTauriDynamic([appImage, deb], { arch: "x86_64", bundleType: "deb" }, downloadUrl) ??
        "null",
    ) as { readonly version: string };
    expect(forDeb.version).toBe("1.4.0");
    const unknown = JSON.parse(
      renderTauriDynamic([appImage, deb], { arch: "x86_64", bundleType: "unknown" }, downloadUrl) ??
        "null",
    ) as { readonly version: string };
    expect(unknown.version).toBe("2.0.0");
    expect(
      renderTauriDynamic([appImage], { arch: "x86_64", bundleType: "rpm" }, downloadUrl),
    ).toBeUndefined();
  });
});

describe(renderWinSparkleAppcast, () => {
  it("renders one item per version with an enclosure per architecture", () => {
    const xml = renderWinSparkleAppcast({
      title: "Updates",
      downloadUrl,
      entries: [
        windowsEntry(
          { id: "x64", winSparkleEdSignature: SIGNATURE },
          { minimumSystemVersion: "10.0.17763" },
        ),
        windowsEntry({ id: "arm" }, { architectures: ["arm64"] }),
        windowsEntry({ id: "x64-msi", artifactFormat: "msi" }),
        windowsEntry({ id: "old", appVersion: "1.3.0", buildNumber: "130" }),
      ],
    });
    expect(xml.match(/<item>/gu)).toHaveLength(2);
    expect(xml).toContain('sparkle:os="windows-x64" sparkle:edSignature');
    expect(xml).toContain('sparkle:os="windows-arm64"/>');
    expect(xml).toContain(
      "<sparkle:minimumSystemVersion>10.0.17763</sparkle:minimumSystemVersion>",
    );
    // The x64 .exe wins over the x64 .msi.
    expect(xml).not.toContain("download/x64-msi/");
  });
});

describe(pickLatestDownload, () => {
  it("takes the newest fully rolled-out release in the preferred format for the architecture", () => {
    const candidate = windowsEntry({ id: "candidate", appVersion: "2.0.0", rolloutPercentage: 10 });
    const msi = windowsEntry({ id: "msi", artifactFormat: "msi" });
    const exe = windowsEntry({ id: "exe" });
    const arm = windowsEntry({ id: "arm" }, { architectures: ["arm64"] });
    const pick = (arch: "x64" | "arm64" | undefined, formats: readonly ("exe" | "msi")[]) =>
      pickLatestDownload([candidate, msi, exe, arm], { formats, arch })?.id;
    expect(pick("x64", ["exe", "msi"])).toBe("exe");
    expect(pick("x64", ["msi"])).toBe("msi");
    expect(pick("arm64", ["exe", "msi"])).toBe("arm");
  });

  it("treats a Mac build with no recorded architecture as universal", () => {
    expect(pickLatestDownload([entry()], { formats: ["dmg"], arch: "arm64" })?.id).toBe(entry().id);
  });
});

describe(renderReleaseIndex, () => {
  it("lists each platform's newest fully rolled-out version and its files", () => {
    const json = JSON.parse(
      renderReleaseIndex({
        channel: "latest",
        downloadUrl,
        platforms: {
          macos: [entry({ id: "dmg" })],
          windows: [
            windowsEntry({ id: "next", appVersion: "2.0.0", rolloutPercentage: 50 }),
            windowsEntry({ id: "exe" }),
          ],
          linux: [],
        },
      }),
    ) as {
      readonly platforms: Record<
        string,
        {
          readonly version: string;
          readonly files: readonly {
            readonly url: string;
            readonly architectures: readonly string[];
          }[];
        }
      >;
    };
    expect(Object.keys(json.platforms)).toStrictEqual(["macos", "windows"]);
    expect(json.platforms["windows"]?.version).toBe("1.4.0");
    expect(json.platforms["windows"]?.files[0]?.url).toBe(
      `${BASE}windows/download/exe/Example-Desktop-Setup-1.4.0-x64.exe`,
    );
    expect(json.platforms["windows"]?.files[0]?.architectures).toStrictEqual(["x64"]);
  });
});
