import { Effect, Layer } from "effect";

import { CloudflareEnvTag, provideCloudflareEnv } from "../../src/cloudflare/context";

export const runWithEnv = <Success, Error>(
  effect: Effect.Effect<Success, Error, CloudflareEnvTag>,
  env: Env,
) => Effect.runPromise(provideCloudflareEnv(effect, env));

export const runEitherWithEnv = <Success, Error>(
  effect: Effect.Effect<Success, Error, CloudflareEnvTag>,
  env: Env,
) => Effect.runPromise(Effect.either(provideCloudflareEnv(effect, env)));

export const runWithEnvExit = <Success, Error>(
  effect: Effect.Effect<Success, Error, CloudflareEnvTag>,
  env: Env,
) => Effect.runPromiseExit(provideCloudflareEnv(effect, env));

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

export const runWithLayerAndEnvExit = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  layer: Layer.Layer<Requirements, never, never>,
  env: Env,
) => runWithEnvExit(effect.pipe(Effect.provide(layer)), env);
