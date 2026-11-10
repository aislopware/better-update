import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { buildIgnoreInstance } from "./project-staging";
import { copyProjectTree } from "./staging-copy";

const makeDir = (prefix: string): string => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const dispose = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

describe(copyProjectTree, () => {
  it.effect("keeps a vendored framework's relative links as written", () =>
    Effect.gen(function* () {
      const source = makeDir("bu-staging-links-");
      const dest = path.join(makeDir("bu-staging-links-dest-"), "project");
      const framework = path.join(source, "Vendor.framework");
      mkdirSync(path.join(framework, "Versions", "A", "Resources"), { recursive: true });
      symlinkSync("A", path.join(framework, "Versions", "Current"));
      symlinkSync("Versions/Current/Resources", path.join(framework, "Resources"));
      const ig = yield* buildIgnoreInstance(source).pipe(Effect.provide(NodeFileSystem.layer));
      yield* copyProjectTree({ source, dest, ig });
      // Absolute links back into the source tree would leave the staged
      // framework pointing outside itself, which codesign refuses.
      expect(readlinkSync(path.join(dest, "Vendor.framework", "Resources"))).toBe(
        "Versions/Current/Resources",
      );
      expect(readlinkSync(path.join(dest, "Vendor.framework", "Versions", "Current"))).toBe("A");
      dispose(source);
      dispose(path.dirname(dest));
    }),
  );

  it.effect(
    "copies what the ignore rules keep, with exec bits and empty dirs, and prunes the rest",
    () =>
      Effect.gen(function* () {
        const source = makeDir("bu-staging-copy-");
        const dest = path.join(makeDir("bu-staging-copy-dest-"), "project");
        try {
          writeFileSync(path.join(source, ".gitignore"), "secrets.env\nbuild/\n");
          mkdirSync(path.join(source, "apps", "mobile", "android"), { recursive: true });
          mkdirSync(path.join(source, "apps", "mobile", "assets", "empty"), { recursive: true });
          mkdirSync(path.join(source, "node_modules", "dep"), { recursive: true });
          mkdirSync(path.join(source, "build"), { recursive: true });
          writeFileSync(path.join(source, "apps", "mobile", ".gitignore"), "local.txt\n");
          writeFileSync(path.join(source, "apps", "mobile", "local.txt"), "x");
          writeFileSync(path.join(source, "apps", "mobile", "App.tsx"), "export {};\n");
          writeFileSync(path.join(source, "apps", "mobile", "android", "gradlew"), "#!/bin/sh\n");
          chmodSync(path.join(source, "apps", "mobile", "android", "gradlew"), 0o755);
          writeFileSync(path.join(source, "node_modules", "dep", "index.js"), "1;\n");
          writeFileSync(path.join(source, "build", "out.bin"), "b");
          writeFileSync(path.join(source, "secrets.env"), "S=1\n");

          const ig = yield* buildIgnoreInstance(source).pipe(Effect.provide(NodeFileSystem.layer));
          yield* copyProjectTree({ source, dest, ig });

          expect(readFileSync(path.join(dest, "apps", "mobile", "App.tsx"), "utf8")).toBe(
            "export {};\n",
          );
          expect(() => {
            accessSync(path.join(dest, "apps", "mobile", "android", "gradlew"), fsConstants.X_OK);
          }).not.toThrow();
          expect(existsSync(path.join(dest, "apps", "mobile", "assets", "empty"))).toBe(true);
          expect(
            ["node_modules", "build", "secrets.env", "apps/mobile/local.txt"].filter((rel) =>
              existsSync(path.join(dest, rel)),
            ),
          ).toStrictEqual([]);
        } finally {
          dispose(source);
          dispose(path.dirname(dest));
        }
      }),
  );
});
