import path from "node:path";

import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  collectProfileEnvKeys,
  overlayProfileEnv,
  overlayProfileEnvItems,
  readProfileEnvKeys,
  resolveEnvironmentScope,
} from "./profile-env";

import type { BuildProfile } from "./build-profile";
import type { DecryptedEnvVar } from "./env-exporter";

const profileWith = (overrides: Partial<BuildProfile>): BuildProfile => ({
  name: "preview",
  environment: "preview",
  ...overrides,
});

describe("resolving the environment scope", () => {
  it("prefers an explicit --environment over the profile's", () => {
    expect(resolveEnvironmentScope("staging", profileWith({ environment: "preview" }))).toBe(
      "staging",
    );
  });

  it("falls back to the profile's environment", () => {
    expect(resolveEnvironmentScope(undefined, profileWith({ environment: "preview" }))).toBe(
      "preview",
    );
  });

  it("defaults to production when neither is given", () => {
    expect(resolveEnvironmentScope(undefined, undefined)).toBe("production");
  });
});

describe("overlaying the profile env block on the server map", () => {
  it("lets profile keys win on collision and keeps server-only keys", () => {
    const merged = overlayProfileEnv(
      { API_URL: "https://prod.example.com", SECRET: "s3cret" },
      profileWith({
        env: { API_URL: "https://preview.example.com", APP_ANDROID_PACKAGE: "com.x" },
      }),
    );
    expect(merged).toStrictEqual({
      API_URL: "https://preview.example.com",
      SECRET: "s3cret",
      APP_ANDROID_PACKAGE: "com.x",
    });
  });

  it("is a no-op without a profile or env block", () => {
    const remote = { API_URL: "https://prod.example.com" };
    expect(overlayProfileEnv(remote, undefined)).toStrictEqual(remote);
    expect(overlayProfileEnv(remote, profileWith({}))).toStrictEqual(remote);
  });
});

describe("overlaying the profile env block on pulled items", () => {
  const items: readonly DecryptedEnvVar[] = [
    { key: "API_URL", value: "https://prod.example.com", visibility: "plaintext" },
    { key: "SECRET", value: "s3cret", visibility: "sensitive" },
  ];

  it("replaces overridden keys, appends profile-only ones, and stays key-sorted", () => {
    const merged = overlayProfileEnvItems(
      items,
      profileWith({
        env: { API_URL: "https://preview.example.com", APP_ANDROID_PACKAGE: "com.x" },
      }),
    );
    expect(merged).toStrictEqual([
      { key: "API_URL", value: "https://preview.example.com", visibility: "plaintext" },
      { key: "APP_ANDROID_PACKAGE", value: "com.x", visibility: "plaintext" },
      { key: "SECRET", value: "s3cret", visibility: "sensitive" },
    ]);
  });

  it("returns the server items untouched without a profile env block", () => {
    expect(overlayProfileEnvItems(items, undefined)).toBe(items);
    expect(overlayProfileEnvItems(items, profileWith({}))).toBe(items);
  });
});

describe("collecting profile env keys for the push guard", () => {
  it("unions env keys across all build profiles", () => {
    expect(
      collectProfileEnvKeys({
        build: {
          production: { env: { API_URL: "https://prod", APP_ID: "com.x" } },
          preview: { env: { API_URL: "https://preview", FLAG: "1" } },
          bare: {},
        },
      }),
    ).toStrictEqual(new Set(["API_URL", "APP_ID", "FLAG"]));
  });

  it("is empty without a build section", () => {
    expect(collectProfileEnvKeys({})).toStrictEqual(new Set());
  });
});

describe("reading profile env keys from eas.json", () => {
  const projectRoot = "/tmp/proj";
  const fsWith = (content: string) =>
    FileSystem.layerNoop({
      readFileString: (filePath: string) =>
        filePath === path.join(projectRoot, "eas.json")
          ? Effect.succeed(content)
          : Effect.die(new Error(`unexpected read: ${filePath}`)),
    });

  it.effect("reads the union of profile env keys", () =>
    Effect.gen(function* () {
      const keys = yield* readProfileEnvKeys(projectRoot).pipe(
        Effect.provide(
          fsWith(JSON.stringify({ build: { production: { env: { APP_ID: "com.x" } } } })),
        ),
      );
      expect(keys).toStrictEqual(new Set(["APP_ID"]));
    }),
  );

  it.effect("falls back to the empty set on a malformed eas.json", () =>
    Effect.gen(function* () {
      const keys = yield* readProfileEnvKeys(projectRoot).pipe(Effect.provide(fsWith("not json")));
      expect(keys).toStrictEqual(new Set());
    }),
  );
});
