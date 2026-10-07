/**
 * What a Windows or Linux artifact says about itself, read from its bytes:
 * the package format from the file name, the architectures from the ELF
 * header (AppImage), the Debian control file (deb) or the RPM header (rpm),
 * else from the file name's arch token (`_amd64`, `-arm64`, `x64-setup`), and
 * an AppImage's embedded electron-builder blockmap. An NSIS installer is a
 * 32-bit stub whatever it installs and an MSI keeps its platform in an OLE
 * property set, so Windows architectures come from the file name alone.
 *
 * No I/O: every reader takes the bytes and returns `undefined` for what it
 * cannot tell, so the caller falls back to the project config or the profile.
 * Reading a deb is async only because its xz decoder is a WebAssembly stream.
 */
import path from "node:path";
import { gunzipSync, inflateRawSync, zstdDecompressSync } from "node:zlib";

import { compact } from "@better-update/type-guards";
import { XzReadableStream } from "xz-decompress";

import type { DesktopArch } from "@better-update/api";

export type DesktopFileTarget =
  | { readonly platform: "windows"; readonly format: "exe" | "msi" }
  | { readonly platform: "linux"; readonly format: "appimage" | "deb" | "rpm" };

const EXTENSIONS: Readonly<Record<string, DesktopFileTarget>> = {
  ".exe": { platform: "windows", format: "exe" },
  ".msi": { platform: "windows", format: "msi" },
  ".appimage": { platform: "linux", format: "appimage" },
  ".deb": { platform: "linux", format: "deb" },
  ".rpm": { platform: "linux", format: "rpm" },
};

/** The platform and format a file name's extension names, or undefined for anything else. */
export const desktopFileTarget = (fileName: string): DesktopFileTarget | undefined =>
  EXTENSIONS[path.extname(fileName).toLowerCase()];

/** Arch tokens as electron-builder, Tauri, Debian and RPM spell them, longest first. */
const NAME_ARCHES: readonly (readonly [RegExp, DesktopArch])[] = [
  [/(?:^|[^a-z0-9])(?:x86_64|amd64|x64)(?![a-z0-9])/iu, "x64"],
  [/(?:^|[^a-z0-9])(?:arm64|aarch64)(?![a-z0-9])/iu, "arm64"],
  [/(?:^|[^a-z0-9])(?:armv7l|armv7hl|armhf|armv7)(?![a-z0-9])/iu, "armv7l"],
  [/(?:^|[^a-z0-9])(?:ia32|i386|i586|i686|x86)(?![a-z0-9_])/iu, "ia32"],
];

/** The architecture a file name's arch token names, or undefined when it names none. */
export const archFromFileName = (fileName: string): DesktopArch | undefined =>
  NAME_ARCHES.find(([pattern]) => pattern.test(path.basename(fileName)))?.[1];

const ELF_MACHINES: Readonly<Record<number, DesktopArch>> = {
  0x03: "ia32",
  0x28: "armv7l",
  0x3e: "x64",
  0xb7: "arm64",
};

/** An ELF executable's `e_machine` (an AppImage's runtime is one). */
export const elfArch = (bytes: Uint8Array): DesktopArch | undefined => {
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ELF_MACHINES[view.getUint16(18, bytes[5] === 1)];
};

/**
 * The size of the blockmap electron-builder appends to an AppImage: raw
 * deflate of the blockmap JSON, then its length as a big-endian u32 — what
 * electron-updater's `blockMapSize` names. Undefined when the file carries none.
 */
export const embeddedBlockMapSize = (bytes: Uint8Array): number | undefined => {
  if (bytes.length < 8) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(bytes.length - 4, false);
  if (size === 0 || size > bytes.length - 4) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      inflateRawSync(bytes.subarray(bytes.length - 4 - size, -4)).toString("utf8"),
    );
    return typeof parsed === "object" && parsed !== null && "files" in parsed ? size : undefined;
  } catch {
    return undefined;
  }
};

const latin1 = (bytes: Uint8Array, start: number, end: number): string =>
  Buffer.from(bytes.subarray(start, end)).toString("latin1");

const AR_MAGIC = "!<arch>\n";

/** The members of an `ar` archive (a `.deb`), by name. */
const arMembers = (bytes: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const members = new Map<string, Uint8Array>();
  if (latin1(bytes, 0, 8) !== AR_MAGIC) {
    return members;
  }
  let offset = 8;
  while (offset + 60 <= bytes.length) {
    const name = latin1(bytes, offset, offset + 16)
      .trim()
      .replace(/\/$/u, "");
    const size = Number.parseInt(latin1(bytes, offset + 48, offset + 58).trim(), 10);
    if (!Number.isFinite(size) || size < 0) {
      break;
    }
    members.set(name, bytes.subarray(offset + 60, offset + 60 + size));
    offset += 60 + size + (size % 2);
  }
  return members;
};

/** A tar archive's file, by name with any `./` stripped. */
const tarFile = (tar: Uint8Array, wanted: string): Uint8Array | undefined => {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = latin1(tar, offset, offset + 100).replace(/\0.*$/su, "");
    if (name === "") {
      return undefined;
    }
    const size = Number.parseInt(
      latin1(tar, offset + 124, offset + 136)
        .replace(/\0.*$/su, "")
        .trim(),
      8,
    );
    if (!Number.isFinite(size)) {
      return undefined;
    }
    if (name.replace(/^\.\//u, "") === wanted) {
      return tar.subarray(offset + 512, offset + 512 + size);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
};

const unxz = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new XzReadableStream(new Blob([new Uint8Array(data)]).stream()),
    ).arrayBuffer(),
  );

/**
 * `control.tar` in any compression dpkg writes: xz (dpkg's and
 * electron-builder's default), gzip (Tauri's), zstd, or none.
 */
const controlTar = async (
  members: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array | undefined> => {
  const plain = members.get("control.tar");
  const gz = members.get("control.tar.gz");
  const xz = members.get("control.tar.xz");
  const zst = members.get("control.tar.zst");
  if (plain !== undefined) {
    return plain;
  }
  if (gz !== undefined) {
    return gunzipSync(gz);
  }
  if (xz !== undefined) {
    return unxz(xz);
  }
  return zst === undefined ? undefined : zstdDecompressSync(zst);
};

const DEBIAN_ARCHES: Readonly<Record<string, DesktopArch>> = {
  amd64: "x64",
  arm64: "arm64",
  i386: "ia32",
  armhf: "armv7l",
};

const RPM_ARCHES: Readonly<Record<string, DesktopArch>> = {
  x86_64: "x64",
  aarch64: "arm64",
  i386: "ia32",
  i586: "ia32",
  i686: "ia32",
  armv7hl: "armv7l",
  armv7l: "armv7l",
  armhfp: "armv7l",
};

export interface PackageFields {
  readonly name?: string;
  readonly version?: string;
  /** `[]` for an architecture-independent package (`all` / `noarch`). */
  readonly architectures?: readonly DesktopArch[];
  /** A deb's control file as written, which the APT repository's `Packages` index repeats. */
  readonly control?: string;
}

const archList = (
  value: string | undefined,
  table: Readonly<Record<string, DesktopArch>>,
  independent: string,
): readonly DesktopArch[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === independent) {
    return [];
  }
  const arch = table[value];
  return arch === undefined ? undefined : [arch];
};

/** A `.deb`'s control fields, the epoch dropped from the version, and the control file itself. */
export const debPackageFields = async (bytes: Uint8Array): Promise<PackageFields | undefined> => {
  try {
    const tar = await controlTar(arMembers(bytes));
    const controlBytes = tar === undefined ? undefined : tarFile(tar, "control");
    if (controlBytes === undefined) {
      return undefined;
    }
    const control = Buffer.from(controlBytes).toString("utf8");
    const fields = new Map(
      control.split("\n").flatMap((line) => {
        const separator = line.indexOf(":");
        return separator > 0 && !/^\s/u.test(line)
          ? [[line.slice(0, separator), line.slice(separator + 1).trim()] as const]
          : [];
      }),
    );
    return compact({
      name: fields.get("Package"),
      version: fields.get("Version")?.replace(/^\d+:/u, ""),
      architectures: archList(fields.get("Architecture"), DEBIAN_ARCHES, "all"),
      control: control.trim() === "" ? undefined : control,
    });
  } catch {
    return undefined;
  }
};

const RPM_TAGS = { name: 1000, version: 1001, arch: 1022 } as const;
const RPM_STRING = 6;
const RPM_HEADER_MAGIC = 0x8e_ad_e8_01;

interface RpmHeader {
  readonly strings: ReadonlyMap<number, string>;
  readonly end: number;
}

/** One RPM header structure at `start`: its string tags and where it ends. */
const rpmHeader = (bytes: Uint8Array, start: number): RpmHeader | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (start + 16 > bytes.length || view.getUint32(start, false) !== RPM_HEADER_MAGIC) {
    return undefined;
  }
  const count = view.getUint32(start + 8, false);
  const storeSize = view.getUint32(start + 12, false);
  const store = start + 16 + count * 16;
  if (store + storeSize > bytes.length) {
    return undefined;
  }
  const strings = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const entry = start + 16 + index * 16;
    const tag = view.getUint32(entry, false);
    if (view.getUint32(entry + 4, false) === RPM_STRING) {
      const from = store + view.getUint32(entry + 8, false);
      const to = bytes.indexOf(0, from);
      strings.set(tag, latin1(bytes, from, to === -1 ? store + storeSize : to));
    }
  }
  return { strings, end: store + storeSize };
};

/** An `.rpm`'s name, version and architecture from its main header. */
export const rpmPackageFields = (bytes: Uint8Array): PackageFields | undefined => {
  if (
    bytes.length < 96 ||
    bytes[0] !== 0xed ||
    bytes[1] !== 0xab ||
    bytes[2] !== 0xee ||
    bytes[3] !== 0xdb
  ) {
    return undefined;
  }
  const signature = rpmHeader(bytes, 96);
  if (signature === undefined) {
    return undefined;
  }
  // The signature header is padded to an 8-byte boundary.
  const main = rpmHeader(bytes, signature.end + ((8 - (signature.end % 8)) % 8));
  if (main === undefined) {
    return undefined;
  }
  return compact({
    name: main.strings.get(RPM_TAGS.name),
    version: main.strings.get(RPM_TAGS.version),
    architectures: archList(main.strings.get(RPM_TAGS.arch), RPM_ARCHES, "noarch"),
  });
};

export interface InspectedDesktopArtifact {
  readonly target: DesktopFileTarget;
  /** Undefined when neither the bytes nor the file name tell. */
  readonly architectures: readonly DesktopArch[] | undefined;
  readonly packageName: string | undefined;
  readonly packageVersion: string | undefined;
  readonly blockMapSize: number | undefined;
  /** A deb's control file. */
  readonly debControl: string | undefined;
}

const fromName = (fileName: string): readonly DesktopArch[] | undefined => {
  const arch = archFromFileName(fileName);
  return arch === undefined ? undefined : [arch];
};

/** Everything a Windows / Linux artifact's bytes and name say about it. */
export const inspectDesktopArtifact = async (
  target: DesktopFileTarget,
  fileName: string,
  bytes: Uint8Array,
): Promise<InspectedDesktopArtifact> => {
  if (target.format === "deb" || target.format === "rpm") {
    const fields =
      target.format === "deb" ? await debPackageFields(bytes) : rpmPackageFields(bytes);
    return {
      target,
      architectures: fields?.architectures ?? fromName(fileName),
      packageName: fields?.name,
      packageVersion: fields?.version,
      blockMapSize: undefined,
      debControl: fields?.control,
    };
  }
  if (target.format === "appimage") {
    const arch = elfArch(bytes);
    return {
      target,
      architectures: arch === undefined ? fromName(fileName) : [arch],
      packageName: undefined,
      packageVersion: undefined,
      blockMapSize: embeddedBlockMapSize(bytes),
      debControl: undefined,
    };
  }
  return {
    target,
    architectures: fromName(fileName),
    packageName: undefined,
    packageVersion: undefined,
    blockMapSize: undefined,
    debControl: undefined,
  };
};
