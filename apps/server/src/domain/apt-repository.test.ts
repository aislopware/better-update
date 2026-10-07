import { aptPackages, parseControl, renderPackages, renderRelease } from "./apt-repository";

import type { DesktopFeedEntry } from "../desktop-release-models";

const CONTROL = [
  "Package: example-app",
  "Version: 1:2.4.0-1",
  "Architecture: amd64",
  "Depends: libgtk-3-0, libnss3",
  "Description: An example app",
  " A longer description.",
  " .",
  " Second paragraph.",
  "",
].join("\n");

const SHA512 = Buffer.alloc(64, 1).toString("base64");

const debEntry = (
  control: string | undefined,
  overrides: Partial<DesktopFeedEntry> = {},
): DesktopFeedEntry => ({
  id: "0190f0aa-0000-7000-8000-000000000001",
  organizationId: "org-1",
  projectId: "project-1",
  buildId: "build-1",
  platform: "linux",
  channel: "latest",
  appVersion: "2.4.0",
  buildNumber: null,
  artifactFormat: "deb",
  releaseNotes: null,
  critical: false,
  rolloutPercentage: 100,
  phasedRolloutHours: null,
  halted: false,
  sha512: SHA512,
  sparkleEdSignature: null,
  winSparkleEdSignature: null,
  tauriSignature: null,
  blockmap: false,
  sparkleDeltas: 0,
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  bundleId: "com.example.app",
  metadataJson: JSON.stringify({
    linux: { architectures: ["x64"], packageName: "example-app", debControl: control },
  }),
  byteSize: 4096,
  r2Key: "builds/example",
  sha256: "AB".repeat(32),
  ...overrides,
});

describe(parseControl, () => {
  it("keeps every field in order, continuation lines included", () => {
    expect(parseControl(CONTROL)?.fields).toStrictEqual([
      ["Package", "example-app"],
      ["Version", "1:2.4.0-1"],
      ["Architecture", "amd64"],
      ["Depends", "libgtk-3-0, libnss3"],
      ["Description", "An example app\n A longer description.\n .\n Second paragraph."],
    ]);
  });

  it.each(["Package", "Version", "Architecture"])("rejects a control file without %s", (field) => {
    const without = CONTROL.split("\n")
      .filter((line) => !line.startsWith(`${field}:`))
      .join("\n");
    expect(parseControl(without)).toBeUndefined();
  });

  it("reads only the first paragraph", () => {
    expect(parseControl(`${CONTROL}\nPackage: other\n`)?.name).toBe("example-app");
  });
});

describe(aptPackages, () => {
  it("lists only debs whose build recorded a parseable control file", () => {
    const listed = aptPackages([
      debEntry(CONTROL),
      debEntry(undefined, { id: "no-control" }),
      debEntry("Package: broken\n", { id: "broken" }),
      debEntry(CONTROL, { id: "appimage", artifactFormat: "appimage" }),
    ]);
    expect(listed.map((pkg) => pkg.entry.id)).toStrictEqual([
      "0190f0aa-0000-7000-8000-000000000001",
    ]);
  });

  it("keeps the newest release of a package version released twice", () => {
    const listed = aptPackages([debEntry(CONTROL, { id: "newer" }), debEntry(CONTROL)]);
    expect(listed.map((pkg) => pkg.entry.id)).toStrictEqual(["newer"]);
  });
});

describe(renderPackages, () => {
  it("is the control file plus where the deb is and its digests", () => {
    expect(renderPackages(aptPackages([debEntry(`${CONTROL}SHA256: forged\n`)]), "amd64")).toBe(
      [
        "Package: example-app",
        "Version: 1:2.4.0-1",
        "Architecture: amd64",
        "Depends: libgtk-3-0, libnss3",
        "Description: An example app",
        " A longer description.",
        " .",
        " Second paragraph.",
        "Filename: pool/0190f0aa-0000-7000-8000-000000000001/example-app_2.4.0_amd64.deb",
        "Size: 4096",
        `SHA256: ${"ab".repeat(32)}`,
        `SHA512: ${"01".repeat(64)}`,
        "",
      ].join("\n"),
    );
  });

  it("lists a deb under its own architecture only, and an `all` deb under every one", () => {
    const packages = aptPackages([
      debEntry(CONTROL),
      debEntry(CONTROL.replace("Architecture: amd64", "Architecture: all"), { id: "all" }),
    ]);
    expect(renderPackages(packages, "amd64").match(/^Package:/gmu)).toHaveLength(2);
    expect(renderPackages(packages, "arm64").match(/^Package:/gmu)).toHaveLength(1);
  });

  it("phases a release below 100 %", () => {
    expect(
      renderPackages(aptPackages([debEntry(CONTROL, { rolloutPercentage: 20 })]), "amd64"),
    ).toContain("\nPhased-Update-Percentage: 20\nFilename:");
  });

  it("is empty for an architecture with nothing released", () => {
    expect(renderPackages(aptPackages([debEntry(CONTROL)]), "armhf")).toBe("");
  });
});

describe(renderRelease, () => {
  it("names the suite, every architecture and each index's digest", () => {
    expect(
      renderRelease({
        label: "project-1",
        channel: "beta",
        date: new Date("2026-10-07T08:00:00Z"),
        files: [{ path: "main/binary-amd64/Packages", size: 12, sha256: "cd".repeat(32) }],
      }),
    ).toBe(
      [
        "Origin: project-1",
        "Label: project-1",
        "Suite: beta",
        "Codename: beta",
        "Date: Wed, 07 Oct 2026 08:00:00 UTC",
        "Architectures: amd64 arm64 armhf i386",
        "Components: main",
        "Acquire-By-Hash: yes",
        "SHA256:",
        ` ${"cd".repeat(32)}               12 main/binary-amd64/Packages`,
        "",
      ].join("\n"),
    );
  });
});
