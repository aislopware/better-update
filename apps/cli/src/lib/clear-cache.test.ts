import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { clearBuildCaches } from "./clear-cache";

describe(clearBuildCaches, () => {
  it.effect("removes Metro's caches from the build's TMPDIR and leaves everything else", () =>
    Effect.gen(function* () {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bu-clear-cache-")));
      try {
        mkdirSync(path.join(root, "metro-cache", "ab"), { recursive: true });
        writeFileSync(path.join(root, "metro-cache", "ab", "entry"), "x");
        writeFileSync(path.join(root, "haste-map-abc123"), "x");
        mkdirSync(path.join(root, "better-update-other-build"));
        writeFileSync(path.join(root, "unrelated.txt"), "keep");

        yield* clearBuildCaches({ TMPDIR: root }).pipe(Effect.provide(NodeFileSystem.layer));

        expect(
          ["metro-cache", "haste-map-abc123", "better-update-other-build", "unrelated.txt"].map(
            (name) => existsSync(path.join(root, name)),
          ),
        ).toStrictEqual([false, false, true, true]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );
});
