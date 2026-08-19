import { Effect } from "effect";

import type { Layer } from "effect";

import { provideCloudflareEnv } from "../../src/cloudflare/context";

import type { CloudflareEnvTag, D1SessionTag } from "../../src/cloudflare/context";

// `provideCloudflareEnv` supplies both the env and a per-call D1 session, so
// effects may require either tag (repos pull the session via `kyselyDb`).
type EnvRequirements = CloudflareEnvTag | D1SessionTag;

export const runWithEnv = async <Success, Error>(
  effect: Effect.Effect<Success, Error, EnvRequirements>,
  env: Env,
) => Effect.runPromise(provideCloudflareEnv(effect, env));

export const runResultWithEnv = async <Success, Error>(
  effect: Effect.Effect<Success, Error, EnvRequirements>,
  env: Env,
) => Effect.runPromise(Effect.result(provideCloudflareEnv(effect, env)));

export const runWithLayerAndEnv = async <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  layer: Layer.Layer<Requirements>,
  env: Env,
) => runWithEnv(effect.pipe(Effect.provide(layer)), env);

export const runResultWithLayerAndEnv = async <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  layer: Layer.Layer<Requirements>,
  env: Env,
) => runResultWithEnv(effect.pipe(Effect.provide(layer)), env);
