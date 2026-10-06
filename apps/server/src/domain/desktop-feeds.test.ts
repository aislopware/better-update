import {
  artifactBlockmapKey,
  blockmapVersionOf,
  ELECTRON_FEED_FILE,
  feedFileName,
  pickElectronRelease,
  renderAppcast,
  renderBlockmap,
  renderElectronYml,
  renderTauriDynamic,
  renderTauriStatic,
  TAURI_FEED_FILE,
} from "./desktop-feeds";

import type { DesktopFeedEntry } from "../desktop-release-models";

const SHA512 = `${"A".repeat(86)}==`;
const SIGNATURE = `${"B".repeat(86)}==`;

const withArchitectures = (architectures: readonly string[]) =>
  JSON.stringify({ macos: { appName: "Example Desktop", architectures } });

const entry = (overrides: Partial<DesktopFeedEntry> = {}): DesktopFeedEntry => ({
  id: "0190f0aa-0000-7000-8000-000000000001",
  organizationId: "org-1",
  projectId: "project-1",
  buildId: "build-1",
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
  tauriSignature: null,
  blockmap: false,
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

describe(renderAppcast, () => {
  const base = "https://updates.example.com/feeds/project-1/macos/";

  it("renders a Sparkle item with versions, minimum OS, signature and download URL", () => {
    const xml = renderAppcast({ title: "Updates", feedBaseUrl: base, entries: [entry()] });
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
      feedBaseUrl: base,
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
      feedBaseUrl: base,
      entries: [entry({ metadataJson: withArchitectures(["arm64"]), phasedRolloutHours: 24 })],
    });
    expect(xml).toContain("<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>");
    expect(xml).toContain("<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>");
  });

  it("leaves universal and Intel builds to every Mac and unphased releases to every client", () => {
    const xml = renderAppcast({
      title: "Updates",
      feedBaseUrl: base,
      entries: [
        entry({ metadataJson: withArchitectures(["arm64", "x86_64"]) }),
        entry({ metadataJson: withArchitectures(["x86_64"]) }),
      ],
    });
    expect(xml).not.toContain("hardwareRequirements");
    expect(xml).not.toContain("phasedRolloutInterval");
  });
});

describe(pickElectronRelease, () => {
  it("takes the newest zip with a version and skips other containers", () => {
    const zip = entry({ id: "zip-release", artifactFormat: "zip" });
    expect(
      pickElectronRelease([
        entry({ artifactFormat: "dmg" }),
        zip,
        entry({ artifactFormat: "zip" }),
      ]),
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
    expect(pickElectronRelease([arm, intel, olderIntel, previous])).toStrictEqual({
      version: "1.4.0",
      files: [arm, intel],
    });
  });

  it("skips a newer zip without a version", () => {
    const zip = entry({ id: "versioned", artifactFormat: "zip" });
    expect(
      pickElectronRelease([entry({ artifactFormat: "zip", appVersion: null }), zip]),
    ).toStrictEqual({ version: "1.4.0", files: [zip] });
  });

  it("has nothing without a versioned zip", () => {
    expect(
      pickElectronRelease([entry({ artifactFormat: "zip", appVersion: null })]),
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

  it("matches only channel feed file names", () => {
    expect(ELECTRON_FEED_FILE.exec("beta-mac.yml")?.groups?.["channel"]).toBe("beta");
    expect(ELECTRON_FEED_FILE.exec("../x-mac.yml")).toBeNull();
  });
});

describe(renderTauriStatic, () => {
  const base = "https://updates.example.com/feeds/project-1/macos/";
  const tarball = (overrides: Partial<DesktopFeedEntry> = {}) =>
    entry({ artifactFormat: "tar.gz", tauriSignature: "VEFVUkk=", ...overrides });

  it("names a Tauri archive the way Tauri's bundler does", () => {
    expect(feedFileName(tarball())).toBe("Example-Desktop-1.4.0.app.tar.gz");
  });

  it("serves a universal build under both Mac architectures", () => {
    const json: unknown = JSON.parse(
      renderTauriStatic([tarball({ id: "rel-u", releaseNotes: "Notes" })], base) ?? "null",
    );
    const platform = {
      url: `${base}download/rel-u/Example-Desktop-1.4.0.app.tar.gz`,
      signature: "VEFVUkk=",
    };
    expect(json).toStrictEqual({
      version: "1.4.0",
      notes: "Notes",
      pub_date: "2026-10-05T10:00:00.000Z",
      platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
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
        base,
      ) ?? "null",
    ) as { readonly version: string; readonly platforms: Record<string, { url: string }> };
    expect(json.version).toBe("1.4.0");
    expect(json.platforms["darwin-aarch64"]?.url).toContain("download/arm/");
    expect(json.platforms["darwin-x86_64"]?.url).toContain("download/intel/");
  });

  it("has nothing to offer without a signed archive", () => {
    expect(renderTauriStatic([entry(), tarball({ tauriSignature: null })], base)).toBeUndefined();
  });
});

describe(renderTauriDynamic, () => {
  const base = "https://updates.example.com/feeds/project-1/macos/";

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
    expect(JSON.parse(renderTauriDynamic([arm, intel], "x86_64", base) ?? "null")).toStrictEqual({
      version: "1.4.0",
      pub_date: "2026-10-05T10:00:00.000Z",
      url: `${base}download/intel/Example-Desktop-1.4.0-x64.app.tar.gz`,
      signature: "SU5URUw=",
    });
    expect(renderTauriDynamic([arm], "x86_64", base)).toBeUndefined();
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
