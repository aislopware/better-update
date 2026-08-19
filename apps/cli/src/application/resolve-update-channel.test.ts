import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeOutputModeLayer } from "../lib/output-mode";
import { resolveUpdateChannel } from "./resolve-update-channel";

import type { BuildProfile } from "../lib/build-profile";

const makeProject = (options: {
  readonly withExpoUpdates: boolean;
}): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bu-resolve-channel-"));
  writeFileSync(
    nodePath.join(dir, "package.json"),
    JSON.stringify({
      dependencies: options.withExpoUpdates ? { "expo-updates": "~29.0.0" } : { react: "19.1.0" },
    }),
  );
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const profile = (channel?: string): BuildProfile => ({
  name: "production",
  environment: "production",
  ...(channel === undefined ? {} : { channel }),
});

const layer = Layer.mergeAll(NodeServices.layer, makeOutputModeLayer(false));

describe(resolveUpdateChannel, () => {
  // The regression this guards: the channel used to be gated on the "expo"
  // build strategy, so a bare project committing its own ios/ + android/ got
  // `undefined` and shipped a binary with no expo-channel-name header at all —
  // silently falling back to the server's default channel.
  it.effect("returns the profile channel for a project that does not prebuild", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({ withExpoUpdates: true });
      const channel = yield* resolveUpdateChannel({
        userCwd: dir,
        profile: profile("preview"),
      }).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(channel).toBe("preview");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("skips injection when expo-updates is not a dependency", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({ withExpoUpdates: false });
      const channel = yield* resolveUpdateChannel({
        userCwd: dir,
        profile: profile("preview"),
      }).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(channel).toBeUndefined();
    }).pipe(Effect.provide(layer)),
  );

  // Fail fast rather than ship a binary that cannot tell the server which
  // channel it is on — the whole point of not defaulting silently.
  it.effect("fails when expo-updates is installed but the profile has no channel", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({ withExpoUpdates: true });
      const result = yield* resolveUpdateChannel({
        userCwd: dir,
        profile: profile(),
      }).pipe(Effect.result, Effect.ensuring(Effect.sync(dispose)));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain('has no "channel"');
      }
    }).pipe(Effect.provide(layer)),
  );
});
