import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { ProjectNotLinkedError } from "./exit-codes";
import { readProjectId } from "./project-link";
import { failureError } from "./test-utils";

// @expo/config requires the project root to be a real path (not a symlink); on
// macOS os.tmpdir() is a symlink, so resolve it.
const makeProjectDir = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const writeFile = (dir: string, name: string, content: string): void => {
  writeFileSync(path.join(dir, name), content);
};

/** CliRuntime stub with a controllable env + cwd for resolver precedence tests. */
const runtimeLayer = (cwd: string, env: Readonly<Record<string, string>> = {}) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux" as NodeJS.Platform,
    cwd: Effect.succeed(cwd),
    getEnv: (name: string) => Effect.succeed(env[name]),
    homeDirectory: Effect.succeed(cwd),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

describe("readProjectId resolver", () => {
  it.effect("prefers BETTER_UPDATE_PROJECT_ID over everything else", () =>
    Effect.gen(function* () {
      // cwd has a conflicting eas.json — the env override must win.
      const dir = makeProjectDir("resolver-env-");
      writeFile(dir, "eas.json", JSON.stringify({ projectId: "from_file" }));
      const id = yield* readProjectId.pipe(
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
        Effect.provide(
          Layer.mergeAll(
            runtimeLayer(dir, { BETTER_UPDATE_PROJECT_ID: "from_env" }),
            NodeFileSystem.layer,
          ),
        ),
      );
      expect(id).toBe("from_env");
    }),
  );

  it.effect("falls back to eas.json's top-level projectId (no Expo config needed)", () =>
    Effect.gen(function* () {
      const dir = makeProjectDir("resolver-file-");
      writeFile(dir, "eas.json", JSON.stringify({ projectId: "proj_from_json" }));
      const id = yield* readProjectId.pipe(
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
        Effect.provide(Layer.mergeAll(runtimeLayer(dir), NodeFileSystem.layer)),
      );
      expect(id).toBe("proj_from_json");
    }),
  );

  it.effect("falls back to the Expo config's extra.betterUpdate.projectId", () =>
    Effect.gen(function* () {
      const dir = makeProjectDir("resolver-expo-");
      writeFile(dir, "package.json", JSON.stringify({ name: "x", version: "1.0.0" }));
      writeFile(
        dir,
        "app.json",
        JSON.stringify({
          expo: { slug: "x", extra: { betterUpdate: { projectId: "proj_expo" } } },
        }),
      );
      const id = yield* readProjectId.pipe(
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
        Effect.provide(Layer.mergeAll(runtimeLayer(dir), NodeFileSystem.layer)),
      );
      expect(id).toBe("proj_expo");
    }),
  );

  it.effect("fails with ProjectNotLinkedError listing every source when unlinked", () =>
    Effect.gen(function* () {
      const dir = makeProjectDir("resolver-none-");
      const exit = yield* readProjectId.pipe(
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
        Effect.provide(Layer.mergeAll(runtimeLayer(dir), NodeFileSystem.layer)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(ProjectNotLinkedError);
        expect(err!.message).toContain("BETTER_UPDATE_PROJECT_ID");
        expect(err!.message).toContain("eas.json");
      }
    }),
  );
});
