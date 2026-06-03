import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  listBuildProfileNames,
  readBuildConfig,
  readSubmitProfile,
} from "./better-update-build-config";
import { BETTER_UPDATE_CONFIG_FILENAME } from "./better-update-config";
import { readBuildProfile } from "./build-profile";

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bu-build-config-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const writeBetterUpdate = (dir: string, value: unknown): void => {
  writeFileSync(nodePath.join(dir, BETTER_UPDATE_CONFIG_FILENAME), JSON.stringify(value));
};

const writeEas = (dir: string, value: unknown): void => {
  writeFileSync(nodePath.join(dir, "eas.json"), JSON.stringify(value));
};

describe(readBuildConfig, () => {
  it.effect("returns an empty config when better-update.json is absent", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const config = yield* readBuildConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(config.build).toBeUndefined();
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("parses the build section from better-update.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, {
        projectId: "proj_1",
        build: { production: { distribution: "store" } },
      });
      const config = yield* readBuildConfig(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(Object.keys(config.build ?? {})).toStrictEqual(["production"]);
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(readBuildProfile, () => {
  it.effect("prefers better-update.json over eas.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, {
        build: { production: { android: { format: "aab", distribution: "play-store" } } },
      });
      writeEas(dir, {
        build: { production: { android: { format: "apk", distribution: "direct" } } },
      });
      const profile = yield* readBuildProfile(dir, "production").pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(profile.android?.format).toBe("aab");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("ignores eas.json entirely (no fallback)", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, { projectId: "proj_1" });
      writeEas(dir, { build: { production: { distribution: "store" } } });
      const result = yield* readBuildProfile(dir, "production").pipe(
        Effect.either,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("resolves generic xcode/gradle fields from better-update.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, {
        build: {
          production: {
            ios: { distribution: "app-store", workspace: "ios/App.xcworkspace" },
            android: { format: "aab", distribution: "play-store", module: "composeApp" },
          },
        },
      });
      const profile = yield* readBuildProfile(dir, "production").pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(profile.ios?.workspace).toBe("ios/App.xcworkspace");
      expect(profile.android?.module).toBe("composeApp");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(listBuildProfileNames, () => {
  it.effect("lists names from better-update.json, ignoring eas.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, { build: { production: {}, preview: {} } });
      writeEas(dir, { build: { staging: {} } });
      const names = yield* listBuildProfileNames(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect([...names].toSorted()).toStrictEqual(["preview", "production"]);
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("returns [] when neither source defines profiles", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const names = yield* listBuildProfileNames(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(names).toStrictEqual([]);
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe(readSubmitProfile, () => {
  it.effect("reads the submit profile from better-update.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeBetterUpdate(dir, {
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
