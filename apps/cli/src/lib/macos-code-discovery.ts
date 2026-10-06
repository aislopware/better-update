/**
 * Discovery half of macOS code signing: find every code item inside an `.app`
 * (nested bundles, loose Mach-O files), tell executables from libraries, and
 * resolve which file is each bundle's main executable — the one its bundle
 * signature covers, so it must not be signed on its own.
 */
import { open, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { parsePlist } from "./plist";

/** Bundle-shaped directories codesign treats as one nested code unit. */
const NESTED_BUNDLE_EXTENSIONS = [".framework", ".app", ".xpc", ".appex", ".bundle", ".plugin"];

/** Loose files that are always code, regardless of exec bit. */
const CODE_FILE_EXTENSIONS = [".dylib", ".so", ".node"];

const hasExtension = (name: string, extensions: readonly string[]): boolean => {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
};

// ── Mach-O header ─────────────────────────────────────────────────

/** `mach_header.filetype` values that matter for signing decisions. */
export type MachOKind = "executable" | "dylib" | "bundle" | "other";

const FILETYPE_KINDS: Readonly<Record<number, MachOKind>> = {
  2: "executable",
  6: "dylib",
  8: "bundle",
};

const HEADER_BYTES = 32;

const kindOf = (filetype: number): MachOKind => FILETYPE_KINDS[filetype] ?? "other";

/** File type of a thin Mach-O header in either byte order; `null` if not thin Mach-O. */
const thinMachOKind = (header: Buffer): MachOKind | null => {
  if (header.length < 16) {
    return null;
  }
  switch (header.toString("hex", 0, 4)) {
    case "cffaedfe":
    case "cefaedfe": {
      return kindOf(header.readUInt32LE(12));
    }
    case "feedfacf":
    case "feedface": {
      return kindOf(header.readUInt32BE(12));
    }
    default: {
      return null;
    }
  }
};

/**
 * Byte offset of a fat (universal) binary's first slice, read from its first
 * `fat_arch` (32-bit offsets) or `fat_arch_64` entry; `undefined` when the
 * header is not a big-endian fat header.
 */
export const fatSliceOffset = (header: Buffer): number | undefined => {
  if (header.length < 24) {
    return undefined;
  }
  switch (header.toString("hex", 0, 4)) {
    case "cafebabe": {
      return header.readUInt32BE(16);
    }
    case "cafebabf": {
      return Number(header.readBigUInt64BE(16));
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Classify a Mach-O: thin binaries directly, fat binaries via their first
 * slice's header (every slice of a universal binary has the same file type).
 * `null` for anything that is not Mach-O, which filters exec-bit shell scripts
 * and data files out of the signing list — signing those churns resources for
 * no gain and can break scripts that self-inspect. Exported for tests.
 */
export const classifyMachO = (header: Buffer, firstSlice: Buffer | undefined): MachOKind | null => {
  if (fatSliceOffset(header) !== undefined) {
    return firstSlice === undefined ? "other" : (thinMachOKind(firstSlice) ?? "other");
  }
  return thinMachOKind(header);
};

const readMachOKind = (filePath: string) =>
  Effect.promise(async () => {
    const handle = await open(filePath, "r");
    try {
      const header = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
      const head = header.subarray(0, bytesRead);
      const offset = fatSliceOffset(head);
      if (offset === undefined) {
        return classifyMachO(head, undefined);
      }
      const slice = Buffer.alloc(HEADER_BYTES);
      const sliceRead = await handle.read(slice, 0, HEADER_BYTES, offset);
      return classifyMachO(head, slice.subarray(0, sliceRead.bytesRead));
    } finally {
      await handle.close();
    }
  });

// ── nested code ───────────────────────────────────────────────────

export interface NestedCodeItem {
  readonly path: string;
  /** `bundle` for bundle directories; the Mach-O kind for loose files. */
  readonly kind: "bundle" | MachOKind;
}

const listEntries = (dirPath: string) =>
  Effect.promise(async () => readdir(dirPath, { withFileTypes: true }));

/**
 * Recursively collect nested code inside `dirPath`: bundle directories and
 * loose Mach-O files. Symlinks are never followed (framework `Versions/Current`
 * links would double-visit), and the outer bundle itself is NOT in the result.
 */
export const collectNestedCode = (dirPath: string): Effect.Effect<readonly NestedCodeItem[]> =>
  Effect.gen(function* () {
    const entries = yield* listEntries(dirPath);
    const collected = yield* Effect.all(
      entries.map((entry) =>
        Effect.gen(function* () {
          if (entry.isSymbolicLink()) {
            return [] as readonly NestedCodeItem[];
          }
          const entryPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            // Descend even into bundle dirs: frameworks carry loose dylibs of
            // their own that need individual signatures underneath the
            // framework's.
            const own: readonly NestedCodeItem[] = hasExtension(
              entry.name,
              NESTED_BUNDLE_EXTENSIONS,
            )
              ? [{ path: entryPath, kind: "bundle" }]
              : [];
            return [...own, ...(yield* collectNestedCode(entryPath))];
          }
          if (!entry.isFile()) {
            return [];
          }
          const kind = yield* readMachOKind(entryPath);
          if (kind !== null) {
            return [{ path: entryPath, kind }];
          }
          return hasExtension(entry.name, CODE_FILE_EXTENSIONS)
            ? [{ path: entryPath, kind: "dylib" as const }]
            : [];
        }),
      ),
    );
    return collected.flat();
  });

/**
 * Inside-out signing order: deepest paths first so every nested item is sealed
 * before the code that contains it. Ties break lexicographically for
 * determinism. The outer bundle is appended by the caller, never here.
 */
export const orderForSigning = <T extends { readonly path: string }>(
  items: readonly T[],
): readonly T[] =>
  [...items].toSorted((left, right) => {
    const depthLeft = left.path.split(path.sep).length;
    const depthRight = right.path.split(path.sep).length;
    return depthRight === depthLeft ? left.path.localeCompare(right.path) : depthRight - depthLeft;
  });

// ── bundle metadata ───────────────────────────────────────────────

export interface BundleInfo {
  readonly bundleId: string | undefined;
  /** Absolute path of the main executable, when the bundle declares one. */
  readonly mainExecutable: string | undefined;
}

const readPlistAt = (plistPath: string) =>
  Effect.promise(async () => {
    try {
      return parsePlist(await readFile(plistPath));
    } catch {
      return undefined;
    }
  });

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Read a bundle's identifier and main executable. Frameworks keep both under
 * `Versions/<current>/` (`Resources/Info.plist`, binary at the version root);
 * every other bundle kind uses the `Contents/` layout. The returned executable
 * path is built from the literal `Versions/<current>` directory — never a
 * realpath — so it compares equal to what {@link collectNestedCode} reports.
 */
export const readBundleInfo = (bundlePath: string) =>
  Effect.gen(function* () {
    if (bundlePath.toLowerCase().endsWith(".framework")) {
      const current = yield* Effect.promise(async () => {
        try {
          return await readlink(path.join(bundlePath, "Versions", "Current"));
        } catch {
          return undefined;
        }
      });
      const versionDir =
        current === undefined ? bundlePath : path.join(bundlePath, "Versions", current);
      const info = yield* readPlistAt(path.join(versionDir, "Resources", "Info.plist"));
      const executable = stringField(info?.["CFBundleExecutable"]);
      return {
        bundleId: stringField(info?.["CFBundleIdentifier"]),
        mainExecutable: executable === undefined ? undefined : path.join(versionDir, executable),
      } satisfies BundleInfo;
    }
    const info = yield* readPlistAt(path.join(bundlePath, "Contents", "Info.plist"));
    const executable = stringField(info?.["CFBundleExecutable"]);
    return {
      bundleId: stringField(info?.["CFBundleIdentifier"]),
      mainExecutable:
        executable === undefined
          ? undefined
          : path.join(bundlePath, "Contents", "MacOS", executable),
    } satisfies BundleInfo;
  });

/** Reverse-DNS-safe identifier suffix for a loose code file (`-i <id>`). */
export const looseCodeIdentifier = (ownerBundleId: string, filePath: string): string =>
  `${ownerBundleId}.${path.basename(filePath).replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`;
