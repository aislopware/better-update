import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  classifyMachO,
  collectNestedCode,
  looseCodeIdentifier,
  orderForSigning,
  readBundleInfo,
} from "./macos-code-discovery";
import { buildPlistXml } from "./plist";

/** 64-bit little-endian thin header with the given `filetype`. */
const thinHeader = (filetype: number): Buffer => {
  const header = Buffer.alloc(32);
  header.write("cffaedfe", 0, "hex");
  header.writeUInt32LE(filetype, 12);
  return header;
};

/** Big-endian fat header whose first slice starts at `offset`. */
const fatHeader = (offset: number): Buffer => {
  const header = Buffer.alloc(32);
  header.write("cafebabe", 0, "hex");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(offset, 16);
  return header;
};

describe(classifyMachO, () => {
  it("classifies thin executables, dylibs, and bundles", () => {
    expect(classifyMachO(thinHeader(2), undefined)).toBe("executable");
    expect(classifyMachO(thinHeader(6), undefined)).toBe("dylib");
    expect(classifyMachO(thinHeader(8), undefined)).toBe("bundle");
  });

  it("classifies a universal binary by its first slice", () => {
    expect(classifyMachO(fatHeader(16_384), thinHeader(2))).toBe("executable");
  });

  it("still counts a fat binary whose slice cannot be read as code", () => {
    expect(classifyMachO(fatHeader(16_384), undefined)).toBe("other");
  });

  it("rejects scripts and truncated files", () => {
    expect(classifyMachO(Buffer.from("#!/bin/sh\nexit 0\n"), undefined)).toBeNull();
    expect(classifyMachO(Buffer.from("cffaedfe", "hex"), undefined)).toBeNull();
  });
});

describe(orderForSigning, () => {
  it("sorts deepest paths first, ties lexicographically", () => {
    const ordered = orderForSigning([
      { path: "/a/App.app/Contents/Frameworks/B.framework" },
      { path: "/a/App.app/Contents/Frameworks/B.framework/Versions/A/Libraries/lib.dylib" },
      { path: "/a/App.app/Contents/Frameworks/A.framework" },
    ]);
    expect(ordered.map((item) => item.path)).toStrictEqual([
      "/a/App.app/Contents/Frameworks/B.framework/Versions/A/Libraries/lib.dylib",
      "/a/App.app/Contents/Frameworks/A.framework",
      "/a/App.app/Contents/Frameworks/B.framework",
    ]);
  });
});

describe(looseCodeIdentifier, () => {
  it("prefixes the owner bundle id and sanitizes the file name", () => {
    expect(looseCodeIdentifier("com.example.app", "/x/My.app/Contents/MacOS/my_engine")).toBe(
      "com.example.app.my-engine",
    );
  });
});

/**
 * A Tauri-shaped app: main executable + sidecar side by side in
 * `Contents/MacOS`, a versioned framework with a loose dylib, an XPC service,
 * and a shell script that must not be treated as code.
 */
const makeFixtureApp = (root: string) =>
  Effect.promise(async () => {
    const app = path.join(root, "My.app");
    const macos = path.join(app, "Contents", "MacOS");
    const framework = path.join(app, "Contents", "Frameworks", "Kit.framework");
    const versionA = path.join(framework, "Versions", "A");
    const xpc = path.join(app, "Contents", "XPCServices", "Helper.xpc");
    await mkdir(macos, { recursive: true });
    await mkdir(path.join(versionA, "Resources"), { recursive: true });
    await mkdir(path.join(versionA, "Libraries"), { recursive: true });
    await mkdir(path.join(xpc, "Contents", "MacOS"), { recursive: true });
    await writeFile(
      path.join(app, "Contents", "Info.plist"),
      buildPlistXml({ CFBundleIdentifier: "com.example.app", CFBundleExecutable: "My" }),
    );
    await writeFile(path.join(macos, "My"), thinHeader(2));
    await writeFile(path.join(macos, "engine"), fatHeader(32));
    await writeFile(path.join(macos, "launch.sh"), "#!/bin/sh\nexit 0\n");
    await writeFile(
      path.join(versionA, "Resources", "Info.plist"),
      buildPlistXml({ CFBundleIdentifier: "com.example.kit", CFBundleExecutable: "Kit" }),
    );
    await writeFile(path.join(versionA, "Kit"), thinHeader(6));
    await writeFile(path.join(versionA, "Libraries", "libextra.dylib"), thinHeader(6));
    await symlink("A", path.join(framework, "Versions", "Current"));
    await symlink("Versions/Current/Kit", path.join(framework, "Kit"));
    await writeFile(
      path.join(xpc, "Contents", "Info.plist"),
      buildPlistXml({ CFBundleIdentifier: "com.example.app.helper", CFBundleExecutable: "Helper" }),
    );
    await writeFile(path.join(xpc, "Contents", "MacOS", "Helper"), thinHeader(2));
    return { app, macos, framework, versionA, xpc };
  });

const withTempDir = <Value, Failure>(use: (root: string) => Effect.Effect<Value, Failure>) =>
  Effect.acquireUseRelease(
    Effect.promise(async () => mkdtemp(path.join(tmpdir(), "macos-discovery-test-"))),
    use,
    (root) => Effect.promise(async () => rm(root, { recursive: true, force: true })),
  );

describe(collectNestedCode, () => {
  it.effect("finds bundles and Mach-O files with their kinds; skips scripts and symlinks", () =>
    withTempDir((root) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixtureApp(root);
        const found = yield* collectNestedCode(fixture.app);
        // The universal sidecar's slice header is unreadable here (only the fat
        // header was written), so it is code of kind "other".
        const byPath = (left: { readonly path: string }, right: { readonly path: string }) =>
          left.path.localeCompare(right.path);
        expect([...found].toSorted(byPath)).toStrictEqual(
          [
            { path: fixture.framework, kind: "bundle" },
            { path: path.join(fixture.versionA, "Kit"), kind: "dylib" },
            { path: path.join(fixture.versionA, "Libraries", "libextra.dylib"), kind: "dylib" },
            { path: path.join(fixture.macos, "My"), kind: "executable" },
            { path: path.join(fixture.macos, "engine"), kind: "other" },
            { path: fixture.xpc, kind: "bundle" },
            { path: path.join(fixture.xpc, "Contents", "MacOS", "Helper"), kind: "executable" },
          ].toSorted(byPath),
        );
      }),
    ),
  );
});

describe(readBundleInfo, () => {
  it.effect("resolves app, XPC, and versioned-framework main executables", () =>
    withTempDir((root) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixtureApp(root);
        expect(yield* readBundleInfo(fixture.app)).toStrictEqual({
          bundleId: "com.example.app",
          mainExecutable: path.join(fixture.macos, "My"),
        });
        expect(yield* readBundleInfo(fixture.xpc)).toStrictEqual({
          bundleId: "com.example.app.helper",
          mainExecutable: path.join(fixture.xpc, "Contents", "MacOS", "Helper"),
        });
        // Built from the literal Versions/A path so it matches discovery output.
        expect(yield* readBundleInfo(fixture.framework)).toStrictEqual({
          bundleId: "com.example.kit",
          mainExecutable: path.join(fixture.versionA, "Kit"),
        });
      }),
    ),
  );

  it.effect("reports nothing for a bundle without an Info.plist", () =>
    withTempDir((root) =>
      Effect.gen(function* () {
        const bare = path.join(root, "Bare.app");
        yield* Effect.promise(async () => mkdir(bare));
        expect(yield* readBundleInfo(bare)).toStrictEqual({
          bundleId: undefined,
          mainExecutable: undefined,
        });
      }),
    ),
  );
});
