import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { hasDevClientInstalled } from "./dev-client-check";

const makeFs = (files: Record<string, string>) =>
  FileSystem.layerNoop({
    readFileString: (filePath: string) => {
      const value = files[filePath];
      return value === undefined
        ? Effect.die(new Error(`ENOENT: ${filePath}`))
        : Effect.succeed(value);
    },
  });

describe(hasDevClientInstalled, () => {
  it("returns true when expo-dev-client is in dependencies", async () => {
    const projectRoot = "/tmp/proj";
    const result = await Effect.runPromise(
      hasDevClientInstalled(projectRoot).pipe(
        Effect.provide(
          makeFs({
            [path.join(projectRoot, "package.json")]: JSON.stringify({
              dependencies: { "expo-dev-client": "^4.0.0", react: "18.2.0" },
            }),
          }),
        ),
      ),
    );
    expect(result).toBe(true);
  });

  it("returns true when expo-dev-client is only in devDependencies", async () => {
    const projectRoot = "/tmp/proj";
    const result = await Effect.runPromise(
      hasDevClientInstalled(projectRoot).pipe(
        Effect.provide(
          makeFs({
            [path.join(projectRoot, "package.json")]: JSON.stringify({
              devDependencies: { "expo-dev-client": "^4.0.0" },
            }),
          }),
        ),
      ),
    );
    expect(result).toBe(true);
  });

  it("returns false when package.json exists but has no expo-dev-client", async () => {
    const projectRoot = "/tmp/proj";
    const result = await Effect.runPromise(
      hasDevClientInstalled(projectRoot).pipe(
        Effect.provide(
          makeFs({
            [path.join(projectRoot, "package.json")]: JSON.stringify({
              dependencies: { react: "18.2.0", expo: "~50.0.0" },
            }),
          }),
        ),
      ),
    );
    expect(result).toBe(false);
  });

  it("returns false when package.json is missing", async () => {
    const projectRoot = "/tmp/proj";
    const result = await Effect.runPromise(
      hasDevClientInstalled(projectRoot).pipe(Effect.provide(makeFs({}))),
    );
    expect(result).toBe(false);
  });

  it("returns false when package.json is malformed JSON", async () => {
    const projectRoot = "/tmp/proj";
    const result = await Effect.runPromise(
      hasDevClientInstalled(projectRoot).pipe(
        Effect.provide(makeFs({ [path.join(projectRoot, "package.json")]: "{ not json" })),
      ),
    );
    expect(result).toBe(false);
  });
});
