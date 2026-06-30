import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { materializeEnvFile, usesReactNativeConfig } from "./env-materialize";
import { makeOutputModeLayer } from "./output-mode";

const testLayer = Layer.mergeAll(NodeFileSystem.layer, makeOutputModeLayer(false));

const setupProject = (params: {
  readonly packageJson?: string;
  readonly env?: string;
}): { readonly root: string; readonly envPath: string; readonly dispose: () => void } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "env-materialize-")));
  mkdirSync(root, { recursive: true });
  if (params.packageJson !== undefined) {
    writeFileSync(path.join(root, "package.json"), params.packageJson);
  }
  if (params.env !== undefined) {
    writeFileSync(path.join(root, ".env"), params.env);
  }
  return {
    root,
    envPath: path.join(root, ".env"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
};

const RNC_PKG = JSON.stringify({
  name: "app",
  dependencies: { "react-native": "0.77.0", "react-native-config": "1.5.5" },
});

describe(usesReactNativeConfig, () => {
  it.effect("true when react-native-config is a dependency", () =>
    Effect.gen(function* () {
      const project = setupProject({ packageJson: RNC_PKG });
      try {
        expect(yield* usesReactNativeConfig(project.root)).toBe(true);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("true when react-native-config is a devDependency", () =>
    Effect.gen(function* () {
      const project = setupProject({
        packageJson: JSON.stringify({ devDependencies: { "react-native-config": "1.5.5" } }),
      });
      try {
        expect(yield* usesReactNativeConfig(project.root)).toBe(true);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("false for a bare project without react-native-config", () =>
    Effect.gen(function* () {
      const project = setupProject({
        packageJson: JSON.stringify({ dependencies: { "react-native": "0.77.0" } }),
      });
      try {
        expect(yield* usesReactNativeConfig(project.root)).toBe(false);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("false when package.json is missing or unparseable", () =>
    Effect.gen(function* () {
      const missing = setupProject({});
      const broken = setupProject({ packageJson: "{ not json" });
      try {
        expect(yield* usesReactNativeConfig(missing.root)).toBe(false);
        expect(yield* usesReactNativeConfig(broken.root)).toBe(false);
      } finally {
        missing.dispose();
        broken.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );
});

describe(materializeEnvFile, () => {
  it.effect("merges decrypted env into an existing .env (server wins, local keys kept)", () =>
    Effect.gen(function* () {
      const project = setupProject({
        packageJson: RNC_PKG,
        env: "APP_ID=com.echoparkpaper\nLOCAL_ONLY=keep-me\nAPI_ENDPOINT=https://old.example\n",
      });
      try {
        yield* materializeEnvFile({
          projectRoot: project.root,
          envVars: { API_ENDPOINT: "https://new.example", KLAVIYO_PUBLIC_API_KEY: "pk_123" },
        });
        const env = readFileSync(project.envPath, "utf8");
        // Server value wins on collision.
        expect(env).toContain("API_ENDPOINT=https://new.example");
        expect(env).not.toContain("API_ENDPOINT=https://old.example");
        // New server key appended.
        expect(env).toContain("KLAVIYO_PUBLIC_API_KEY=pk_123");
        // Untouched committed keys preserved.
        expect(env).toContain("APP_ID=com.echoparkpaper");
        expect(env).toContain("LOCAL_ONLY=keep-me");
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("creates .env when missing (react-native-config present)", () =>
    Effect.gen(function* () {
      const project = setupProject({ packageJson: RNC_PKG });
      try {
        yield* materializeEnvFile({
          projectRoot: project.root,
          envVars: { APP_ID: "com.echoparkpaper", VERSION_NAME_APP: "6.0.5" },
        });
        const env = readFileSync(project.envPath, "utf8");
        expect(env).toContain("APP_ID=com.echoparkpaper");
        expect(env).toContain("VERSION_NAME_APP=6.0.5");
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("no-op for a bare project WITHOUT react-native-config (no stray .env)", () =>
    Effect.gen(function* () {
      const project = setupProject({
        packageJson: JSON.stringify({ dependencies: { "react-native": "0.77.0" } }),
      });
      try {
        yield* materializeEnvFile({
          projectRoot: project.root,
          envVars: { APP_ID: "com.echoparkpaper", SECRET: "should-not-be-written" },
        });
        expect(existsSync(project.envPath)).toBe(false);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("no-op when the env set is empty (safe before the vault is populated)", () =>
    Effect.gen(function* () {
      const project = setupProject({ packageJson: RNC_PKG, env: "APP_ID=com.echoparkpaper\n" });
      try {
        const before = readFileSync(project.envPath, "utf8");
        yield* materializeEnvFile({ projectRoot: project.root, envVars: {} });
        expect(readFileSync(project.envPath, "utf8")).toBe(before);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );
});
