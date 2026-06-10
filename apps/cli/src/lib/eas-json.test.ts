import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { readBuildProfile } from "./build-profile";
import {
  listBuildProfileNames,
  readEasJsonRaw,
  readEasLinkedProjectId,
  readEasProjectType,
  readSubmitProfile,
  writeEasJsonPatch,
} from "./eas-json";

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bu-eas-json-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const writeEas = (dir: string, value: unknown): void => {
  writeFileSync(nodePath.join(dir, "eas.json"), JSON.stringify(value));
};

describe(readEasJsonRaw, () => {
  it.effect("returns undefined when eas.json is absent or invalid", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const absent = yield* readEasJsonRaw(dir);
      writeFileSync(nodePath.join(dir, "eas.json"), "{not json");
      const invalid = yield* readEasJsonRaw(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(absent).toBeUndefined();
      expect(invalid).toBeUndefined();
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(writeEasJsonPatch, () => {
  it.effect("creates eas.json and preserves unknown keys on later patches", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      yield* writeEasJsonPatch(dir, { projectId: "proj_1" });
      writeEas(dir, { projectId: "proj_1", build: { production: {} }, custom: "kept" });
      const filePath = yield* writeEasJsonPatch(dir, { projectId: "proj_2" });
      const written: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      expect(written).toStrictEqual({
        projectId: "proj_2",
        build: { production: {} },
        custom: "kept",
      });
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(NodeContext.layer));
  });
});

describe(readEasLinkedProjectId, () => {
  it.effect("reads the top-level projectId extension key", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, { projectId: "proj_1", build: { production: {} } });
      const id = yield* readEasLinkedProjectId(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(id).toBe("proj_1");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("returns undefined for a missing or empty projectId", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, { projectId: "", build: {} });
      const id = yield* readEasLinkedProjectId(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(id).toBeUndefined();
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(readEasProjectType, () => {
  it.effect("reads the top-level projectType extension key", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, { projectType: "kmp" });
      const type = yield* readEasProjectType(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(type).toBe("kmp");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(readBuildProfile, () => {
  it.effect("resolves profiles (incl. generic fields) from eas.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, {
        build: {
          production: {
            channel: "production",
            ios: { distribution: "app-store", workspace: "ios/App.xcworkspace" },
            android: { format: "aab", distribution: "play-store", module: "composeApp" },
          },
        },
      });
      const profile = yield* readBuildProfile(dir, "production").pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(profile.channel).toBe("production");
      expect(profile.ios?.workspace).toBe("ios/App.xcworkspace");
      expect(profile.android?.module).toBe("composeApp");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with a missing-eas.json hint when the file is absent", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      // A legacy better-update.json must NOT be read anymore.
      writeFileSync(
        nodePath.join(dir, "better-update.json"),
        JSON.stringify({ build: { production: { distribution: "store" } } }),
      );
      const result = yield* readBuildProfile(dir, "production").pipe(
        Effect.either,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("No eas.json found");
      }
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails when eas.json is invalid JSON", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeFileSync(nodePath.join(dir, "eas.json"), "{not json");
      const result = yield* readBuildProfile(dir, "production").pipe(
        Effect.either,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(listBuildProfileNames, () => {
  it.effect("lists names from eas.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, { build: { production: {}, preview: {} } });
      const names = yield* listBuildProfileNames(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect([...names].toSorted()).toStrictEqual(["preview", "production"]);
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("returns [] when no eas.json exists", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const names = yield* listBuildProfileNames(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(names).toStrictEqual([]);
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(readSubmitProfile, () => {
  it.effect("reads the submit profile from eas.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeEas(dir, {
        build: { production: { distribution: "store" } },
        submit: { production: { ios: { appleId: "dev@acme.com" } } },
      });
      const submit = yield* readSubmitProfile(dir, "production").pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(submit.ios?.appleId).toBe("dev@acme.com");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
