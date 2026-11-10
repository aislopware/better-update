import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { BUILD_DIR_ENV, acquireBuildWorkDir } from "./build-work-dir";

const DEAD_PID = 2_147_483_646;

const withRoot = <Success, Failure>(run: (root: string) => Effect.Effect<Success, Failure>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(path.join(tmpdir(), "build-work-dir-"))),
    run,
    (root) =>
      Effect.sync(() => {
        rmSync(root, { recursive: true, force: true });
      }),
  );

const acquire = (root: string, cwd = "/nonexistent/project") =>
  acquireBuildWorkDir({ platform: "ios", env: { [BUILD_DIR_ENV]: root }, cwd });

describe(acquireBuildWorkDir, () => {
  it.live("uses a random temp dir when the env is unset", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* acquireBuildWorkDir({ platform: "ios", env: {}, cwd: "/" });
        expect(path.basename(dir)).toMatch(/^better-update-/);
        expect(existsSync(dir)).toBe(true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.live("reuses one path per platform, empty on entry and removed on exit", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const expected = path.join(root, "better-update-ios");
        mkdirSync(expected);
        writeFileSync(path.join(expected, "leftover"), "x");
        const dir = yield* Effect.scoped(
          Effect.gen(function* () {
            const acquired = yield* acquire(root);
            expect(acquired).toBe(expected);
            expect(existsSync(path.join(acquired, "leftover"))).toBe(false);
            expect(statSync(acquired).mode % 0o1000).toBe(0o700);
            expect(existsSync(`${acquired}.lock`)).toBe(true);
            return acquired;
          }),
        );
        expect(existsSync(dir)).toBe(false);
        expect(existsSync(`${dir}.lock`)).toBe(false);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    ),
  );

  it.live("refuses a dir another live build holds", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const lock = path.join(root, "better-update-ios.lock");
        mkdirSync(lock);
        writeFileSync(path.join(lock, "pid"), String(process.pid));
        const error = yield* Effect.flip(Effect.scoped(acquire(root)));
        expect(error.message).toMatch(/in use by another better-update build/);
        expect(existsSync(lock)).toBe(true);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    ),
  );

  it.live("takes over a stale lock left by a dead build", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const lock = path.join(root, "better-update-ios.lock");
        mkdirSync(lock);
        writeFileSync(path.join(lock, "pid"), String(DEAD_PID));
        const dir = yield* Effect.scoped(acquire(root));
        expect(dir).toBe(path.join(root, "better-update-ios"));
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    ),
  );

  it.live("refuses a dir inside or around the project", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const inside = yield* Effect.flip(Effect.scoped(acquire(".", root)));
        expect(inside.message).toMatch(/must point outside the project/);
        const around = yield* Effect.flip(
          Effect.scoped(acquire(root, path.join(root, "better-update-ios", "app"))),
        );
        expect(around.message).toMatch(/must point outside the project/);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    ),
  );
});
