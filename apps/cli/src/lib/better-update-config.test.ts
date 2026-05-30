import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  BETTER_UPDATE_CONFIG_FILENAME,
  readBetterUpdateConfig,
  readLinkedProjectId,
  writeBetterUpdateConfig,
} from "./better-update-config";

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "better-update-config-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const writeConfig = (dir: string, content: string): void => {
  writeFileSync(join(dir, BETTER_UPDATE_CONFIG_FILENAME), content);
};

describe(readBetterUpdateConfig, () => {
  it.effect("returns undefined when the file is absent", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const result = yield* readBetterUpdateConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(result).toBeUndefined();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("returns undefined for invalid JSON (does not throw)", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeConfig(dir, "{ not json");
      const result = yield* readBetterUpdateConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(result).toBeUndefined();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("parses a valid object", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeConfig(dir, JSON.stringify({ projectId: "proj_1", extra: 1 }));
      const result = yield* readBetterUpdateConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(result).toStrictEqual({ projectId: "proj_1", extra: 1 });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe(readLinkedProjectId, () => {
  it.effect("returns the projectId when present", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeConfig(dir, JSON.stringify({ projectId: "proj_42" }));
      const id = yield* readLinkedProjectId(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(id).toBe("proj_42");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("returns undefined when projectId is missing or empty", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeConfig(dir, JSON.stringify({ projectId: "" }));
      const id = yield* readLinkedProjectId(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(id).toBeUndefined();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe(writeBetterUpdateConfig, () => {
  it.effect("creates the file and round-trips the projectId", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const path = yield* writeBetterUpdateConfig(dir, { projectId: "proj_new" });
      const readBack = yield* readLinkedProjectId(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(path).toMatch(/better-update\.json$/u);
      expect(readBack).toBe("proj_new");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("merges into an existing config without dropping other keys", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeConfig(dir, JSON.stringify({ projectId: "old", baseUrl: "https://x.example" }));
      yield* writeBetterUpdateConfig(dir, { projectId: "fresh" });
      const result = yield* readBetterUpdateConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(result).toStrictEqual({ projectId: "fresh", baseUrl: "https://x.example" });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
