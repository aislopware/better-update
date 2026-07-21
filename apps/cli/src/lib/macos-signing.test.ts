import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import { collectNestedCode, isSealedByOuterSignature, orderForSigning } from "./macos-signing";

describe(orderForSigning, () => {
  it("sorts deepest paths first, ties lexicographically", () => {
    const ordered = orderForSigning([
      "/a/App.app/Contents/Frameworks/B.framework",
      "/a/App.app/Contents/Frameworks/B.framework/Versions/A/Libraries/lib.dylib",
      "/a/App.app/Contents/Frameworks/A.framework",
    ]);
    expect(ordered).toStrictEqual([
      "/a/App.app/Contents/Frameworks/B.framework/Versions/A/Libraries/lib.dylib",
      "/a/App.app/Contents/Frameworks/A.framework",
      "/a/App.app/Contents/Frameworks/B.framework",
    ]);
  });
});

describe(isSealedByOuterSignature, () => {
  const app = "/x/My.app";

  it("marks items directly under Contents/MacOS as sealed by the bundle signature", () => {
    expect(isSealedByOuterSignature(app, "/x/My.app/Contents/MacOS/My")).toBe(true);
  });

  it("keeps everything else independently signed", () => {
    expect(isSealedByOuterSignature(app, "/x/My.app/Contents/Frameworks/A.framework")).toBe(false);
    expect(isSealedByOuterSignature(app, "/x/My.app/Contents/MacOS/nested/helper")).toBe(false);
  });
});

describe(collectNestedCode, () => {
  // 64-bit little-endian Mach-O magic.
  const machO = Buffer.from("cffaedfe00000000", "hex");

  it.effect("collects bundles, dylibs, and Mach-O executables; skips scripts and symlinks", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(async () =>
        mkdtemp(path.join(tmpdir(), "macos-signing-test-")),
      );
      const appPath = path.join(root, "My.app");
      const frameworkPath = path.join(appPath, "Contents", "Frameworks", "Dep.framework");
      const libsPath = path.join(frameworkPath, "Versions", "A", "Libraries");
      const helpersPath = path.join(appPath, "Contents", "Helpers");
      yield* Effect.promise(async () => {
        await mkdir(libsPath, { recursive: true });
        await mkdir(helpersPath, { recursive: true });
        await writeFile(path.join(libsPath, "libextra.dylib"), machO);
        await writeFile(path.join(helpersPath, "helper-tool"), machO);
        await writeFile(path.join(helpersPath, "postinstall.sh"), "#!/bin/sh\nexit 0\n");
        await symlink(
          path.join(frameworkPath, "Versions", "A"),
          path.join(frameworkPath, "Versions", "Current"),
        );
      });

      const found = yield* collectNestedCode(appPath);
      yield* Effect.promise(async () => rm(root, { recursive: true, force: true }));

      expect([...found].toSorted()).toStrictEqual(
        [
          frameworkPath,
          path.join(libsPath, "libextra.dylib"),
          path.join(helpersPath, "helper-tool"),
        ].toSorted(),
      );
    }),
  );
});
