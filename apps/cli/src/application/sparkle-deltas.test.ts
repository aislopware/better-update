import type { DesktopRelease } from "@better-update/api";

import {
  compareBundleVersions,
  deltaFormatFor,
  deltaSources,
  deltaWorthIt,
} from "./sparkle-deltas";

const release = (overrides: Partial<DesktopRelease>): DesktopRelease => ({
  id: "release",
  projectId: "project",
  buildId: "build",
  platform: "macos",
  channel: "latest",
  appVersion: "1.0.0",
  buildNumber: "100",
  artifactFormat: "zip",
  releaseNotes: null,
  critical: false,
  rolloutPercentage: 100,
  phasedRolloutHours: null,
  halted: false,
  sparkleSigned: true,
  tauriSigned: false,
  winSparkleSigned: false,
  blockmap: false,
  sparkleDeltas: 0,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  ...overrides,
});

describe(compareBundleVersions, () => {
  it("orders numeric parts as numbers", () => {
    expect(compareBundleVersions("140", "99")).toBe(1);
    expect(compareBundleVersions("1.10", "1.9")).toBe(1);
    expect(compareBundleVersions("1.0", "1")).toBe(0);
    expect(compareBundleVersions("2.0.1", "2.1")).toBe(-1);
  });

  it("orders text parts naturally", () => {
    expect(compareBundleVersions("1.0b2", "1.0b10")).toBe(-1);
  });
});

describe(deltaFormatFor, () => {
  it("picks the newest format the old app's Sparkle applies", () => {
    expect(deltaFormatFor("2064")).toBe(4);
    expect(deltaFormatFor("2041")).toBe(4);
    expect(deltaFormatFor("2040")).toBe(3);
    expect(deltaFormatFor("2010")).toBe(3);
    expect(deltaFormatFor("1.27.1")).toBe(2);
    expect(deltaFormatFor("2009")).toBe(2);
  });

  it("uses the newest format when the app embeds no Sparkle framework", () => {
    expect(deltaFormatFor(undefined)).toBe(4);
  });
});

describe(deltaWorthIt, () => {
  it("keeps a delta under seven eighths of the archive, as generate_appcast does", () => {
    expect(deltaWorthIt(10, 100)).toBe(true);
    expect(deltaWorthIt(87, 100)).toBe(true);
    expect(deltaWorthIt(88, 100)).toBe(false);
  });
});

describe(deltaSources, () => {
  const build = { id: "new", buildNumber: "140" };

  it("takes the newest older Sparkle-signed app archives, one per version", () => {
    const sources = deltaSources(
      [
        release({ id: "r130-beta", buildId: "b130", buildNumber: "130", channel: "beta" }),
        release({ id: "r130", buildId: "b130", buildNumber: "130" }),
        release({ id: "r120", buildId: "b120", buildNumber: "120", artifactFormat: "dmg" }),
        release({ id: "r110", buildId: "b110", buildNumber: "110", artifactFormat: "tar.gz" }),
        release({ id: "r100", buildId: "b100", buildNumber: "100" }),
      ],
      build,
      3,
    );
    expect(sources.map((source) => [source.release.id, source.deltaFrom])).toStrictEqual([
      ["r130-beta", "130"],
      ["r120", "120"],
      ["r110", "110"],
    ]);
  });

  it("skips what cannot take a delta", () => {
    const sources = deltaSources(
      [
        release({ id: "self", buildId: "new", buildNumber: "139" }),
        release({ id: "newer", buildNumber: "150" }),
        release({ id: "same", buildNumber: "140" }),
        release({ id: "unsigned", buildNumber: "130", sparkleSigned: false }),
        release({ id: "pkg", buildNumber: "120", artifactFormat: "pkg" }),
        release({ id: "unversioned", buildNumber: null }),
      ],
      build,
      5,
    );
    expect(sources).toStrictEqual([]);
  });

  it("makes none with a maximum of zero", () => {
    expect(deltaSources([release({ buildNumber: "130" })], build, 0)).toStrictEqual([]);
  });
});
