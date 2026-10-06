import { deflateRawSync, gzipSync, zstdCompressSync } from "node:zlib";

import {
  CONTROL,
  ascii,
  concat,
  deb,
  elf,
  rpm,
  tar,
  u32,
  withBlockmap,
} from "../../tests/helpers/desktop-packages";
import {
  archFromFileName,
  debPackageFields,
  desktopFileTarget,
  elfArch,
  embeddedBlockMapSize,
  inspectDesktopArtifact,
  rpmPackageFields,
} from "./desktop-artifact-inspect";

describe(desktopFileTarget, () => {
  it("maps installer and package extensions, case-insensitively", () => {
    expect(desktopFileTarget("App Setup 1.0.0.exe")).toStrictEqual({
      platform: "windows",
      format: "exe",
    });
    expect(desktopFileTarget("App_1.0.0_x64_en-US.MSI")).toStrictEqual({
      platform: "windows",
      format: "msi",
    });
    expect(desktopFileTarget("App-1.0.0.AppImage")).toStrictEqual({
      platform: "linux",
      format: "appimage",
    });
    expect(desktopFileTarget("app_1.0.0_amd64.deb")).toStrictEqual({
      platform: "linux",
      format: "deb",
    });
    expect(desktopFileTarget("app-1.0.0-1.x86_64.rpm")).toStrictEqual({
      platform: "linux",
      format: "rpm",
    });
  });

  it("rejects anything else", () => {
    expect(desktopFileTarget("App.dmg")).toBeUndefined();
    expect(desktopFileTarget("App.exe.blockmap")).toBeUndefined();
    expect(desktopFileTarget("README")).toBeUndefined();
  });
});

describe(archFromFileName, () => {
  it.each([
    ["App_1.0.0_x64-setup.exe", "x64"],
    ["App_1.0.0_x64_en-US.msi", "x64"],
    ["app_1.0.0_amd64.deb", "x64"],
    ["app-1.0.0-1.x86_64.rpm", "x64"],
    ["App-1.0.0-arm64.AppImage", "arm64"],
    ["app_1.0.0_aarch64.AppImage", "arm64"],
    ["App_1.0.0_x86-setup.exe", "ia32"],
    ["App-Setup-1.0.0-ia32.exe", "ia32"],
    ["app-1.0.0-1.i686.rpm", "ia32"],
    ["app_1.0.0_armhf.deb", "armv7l"],
    ["App-1.0.0-armv7l.AppImage", "armv7l"],
  ] as const)("%s → %s", (fileName, arch) => {
    expect(archFromFileName(fileName)).toBe(arch);
  });

  it("finds no arch in a name without a token, or inside a longer word", () => {
    expect(archFromFileName("App Setup 1.0.0.exe")).toBeUndefined();
    expect(archFromFileName("Max64-1.0.0.AppImage")).toBeUndefined();
    expect(archFromFileName("/builds/x64/App.exe")).toBeUndefined();
  });
});

describe(elfArch, () => {
  it.each([
    [0x3e, "x64"],
    [0xb7, "arm64"],
    [0x03, "ia32"],
    [0x28, "armv7l"],
  ] as const)("reads e_machine %i as %s", (machine, arch) => {
    expect(elfArch(elf(machine))).toBe(arch);
  });

  it("reads a big-endian header", () => {
    const bytes = elf(0);
    bytes[5] = 2;
    new DataView(bytes.buffer).setUint16(18, 0xb7, false);
    expect(elfArch(bytes)).toBe("arm64");
  });

  it("is undefined for a non-ELF file, a truncated one, or an unknown machine", () => {
    expect(elfArch(ascii("MZ not an elf at all, nope"))).toBeUndefined();
    expect(elfArch(elf(0x3e).subarray(0, 10))).toBeUndefined();
    expect(elfArch(elf(0xf3))).toBeUndefined();
  });
});

describe(embeddedBlockMapSize, () => {
  it("finds electron-builder's appended blockmap", () => {
    const { bytes, size } = withBlockmap(elf(0x3e));
    expect(embeddedBlockMapSize(bytes)).toBe(size);
  });

  it("is undefined without one, with a bogus length, or with undecodable data", () => {
    expect(embeddedBlockMapSize(elf(0x3e))).toBeUndefined();
    expect(embeddedBlockMapSize(concat(elf(0x3e), u32(0xff_ff_ff)))).toBeUndefined();
    expect(embeddedBlockMapSize(concat(elf(0x3e), ascii("garbage!"), u32(8)))).toBeUndefined();
    const notABlockmap = deflateRawSync(JSON.stringify({ hello: "world" }));
    expect(
      embeddedBlockMapSize(concat(elf(0x3e), notABlockmap, u32(notABlockmap.length))),
    ).toBeUndefined();
    expect(embeddedBlockMapSize(new Uint8Array(3))).toBeUndefined();
  });
});

describe(debPackageFields, () => {
  it("reads a gzip control member, dropping the epoch", () => {
    expect(
      debPackageFields(deb("control.tar.gz", gzipSync(tar({ "./control": CONTROL })))),
    ).toStrictEqual({
      name: "example-app",
      version: "2.4.0",
      architectures: ["arm64"],
    });
  });

  it("reads zstd and uncompressed control members", () => {
    expect(
      debPackageFields(deb("control.tar.zst", zstdCompressSync(tar({ control: CONTROL }))))?.name,
    ).toBe("example-app");
    expect(
      debPackageFields(deb("control.tar", tar({ "./md5sums": "x", "./control": CONTROL })))
        ?.version,
    ).toBe("2.4.0");
  });

  it("maps amd64, armhf and all", () => {
    const withArch = (arch: string) =>
      debPackageFields(
        deb(
          "control.tar.gz",
          gzipSync(tar({ "./control": `Package: a\nVersion: 1.0.0\nArchitecture: ${arch}\n` })),
        ),
      )?.architectures;
    expect(withArch("amd64")).toStrictEqual(["x64"]);
    expect(withArch("armhf")).toStrictEqual(["armv7l"]);
    expect(withArch("all")).toStrictEqual([]);
    expect(withArch("riscv64")).toBeUndefined();
  });

  it("gives up on an xz control member, a non-deb, and a corrupt archive", () => {
    expect(debPackageFields(deb("control.tar.xz", ascii("ý7zXZ...")))).toBeUndefined();
    expect(debPackageFields(ascii("not an ar archive"))).toBeUndefined();
    expect(debPackageFields(deb("control.tar.gz", ascii("not gzip")))).toBeUndefined();
  });
});

describe(rpmPackageFields, () => {
  it("reads name, version and arch from the main header past the padded signature", () => {
    expect(
      rpmPackageFields(rpm({ 1000: "example-app", 1001: "2.4.0", 1002: "1", 1022: "aarch64" })),
    ).toStrictEqual({
      name: "example-app",
      version: "2.4.0",
      architectures: ["arm64"],
    });
  });

  it("maps noarch to no architecture and unknown arches to undefined", () => {
    expect(rpmPackageFields(rpm({ 1000: "a", 1022: "noarch" }))?.architectures).toStrictEqual([]);
    expect(rpmPackageFields(rpm({ 1000: "a", 1022: "s390x" }))?.architectures).toBeUndefined();
  });

  it("is undefined for a non-rpm or a truncated header", () => {
    expect(rpmPackageFields(ascii("x".repeat(200)))).toBeUndefined();
    expect(rpmPackageFields(rpm({ 1000: "a" }).subarray(0, 120))).toBeUndefined();
  });
});

describe(inspectDesktopArtifact, () => {
  it("prefers what a package records over its file name", () => {
    const inspected = inspectDesktopArtifact(
      { platform: "linux", format: "deb" },
      "example-app_2.4.0_amd64.deb",
      deb("control.tar.gz", gzipSync(tar({ "./control": CONTROL }))),
    );
    expect(inspected.architectures).toStrictEqual(["arm64"]);
    expect(inspected.packageName).toBe("example-app");
  });

  it("falls back to the file name when the package cannot be read", () => {
    const inspected = inspectDesktopArtifact(
      { platform: "linux", format: "deb" },
      "example-app_2.4.0_amd64.deb",
      deb("control.tar.xz", ascii("xz")),
    );
    expect(inspected.architectures).toStrictEqual(["x64"]);
    expect(inspected.packageVersion).toBeUndefined();
  });

  it("reads an AppImage's ELF arch and blockmap", () => {
    const { bytes, size } = withBlockmap(elf(0xb7));
    const inspected = inspectDesktopArtifact(
      { platform: "linux", format: "appimage" },
      "Example-2.4.0-x64.AppImage",
      bytes,
    );
    expect(inspected.architectures).toStrictEqual(["arm64"]);
    expect(inspected.blockMapSize).toBe(size);
  });

  it("takes a Windows installer's arch from its name alone", () => {
    expect(
      inspectDesktopArtifact(
        { platform: "windows", format: "exe" },
        "Example_2.4.0_arm64-setup.exe",
        elf(0x3e),
      ).architectures,
    ).toStrictEqual(["arm64"]);
    expect(
      inspectDesktopArtifact(
        { platform: "windows", format: "exe" },
        "Example Setup 2.4.0.exe",
        new Uint8Array(0),
      ).architectures,
    ).toBeUndefined();
  });
});
