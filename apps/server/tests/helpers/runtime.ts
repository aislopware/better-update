import { Effect, Layer } from "effect";

import { CloudflareEnvTag, D1SessionTag, provideCloudflareEnv } from "../../src/cloudflare/context";

// `provideCloudflareEnv` supplies both the env and a per-call D1 session, so
// effects may require either tag (repos pull the session via `kyselyDb`).
type EnvRequirements = CloudflareEnvTag | D1SessionTag;

export const runWithEnv = <Success, Error>(
  effect: Effect.Effect<Success, Error, EnvRequirements>,
  env: Env,
) => Effect.runPromise(provideCloudflareEnv(effect, env));

export const runEitherWithEnv = <Success, Error>(
  effect: Effect.Effect<Success, Error, EnvRequirements>,
  env: Env,
) => Effect.runPromise(Effect.either(provideCloudflareEnv(effect, env)));

export const runWithLayerAndEnv = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  layer: Layer.Layer<Requirements, never, never>,
  env: Env,
) => runWithEnv(effect.pipe(Effect.provide(layer)), env);

export const runEitherWithLayerAndEnv = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  layer: Layer.Layer<Requirements, never, never>,
  env: Env,
) => runEitherWithEnv(effect.pipe(Effect.provide(layer)), env);
