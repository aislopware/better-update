import { Context, Effect, Option } from "effect";

class CloudflareEnvTag extends Context.Tag("server/CloudflareEnv")<CloudflareEnvTag, Env>() {}
class CloudflareExecutionContextTag extends Context.Tag("server/CloudflareExecutionContext")<
  CloudflareExecutionContextTag,
  ExecutionContext
>() {}

const fromFiberContext = <Identifier, Service>(
  tag: Context.Tag<Identifier, Service>,
  label: string,
): Effect.Effect<Service> =>
  Effect.withFiberRuntime((fiber) =>
    Option.match(Context.getOption(fiber.currentContext, tag), {
      onNone: () => Effect.dieMessage(`${label} is not set`),
      onSome: Effect.succeed,
    }),
  );

export const cloudflareEnv: Effect.Effect<Env> = fromFiberContext(
  CloudflareEnvTag,
  "Cloudflare env",
);

export const cloudflareCtx: Effect.Effect<ExecutionContext> = fromFiberContext(
  CloudflareExecutionContextTag,
  "Cloudflare execution context",
);

export const makeCloudflareRequestContext = (env: Env, ctx: ExecutionContext) =>
  Context.make(CloudflareEnvTag, env).pipe(Context.add(CloudflareExecutionContextTag, ctx));

export const provideCloudflareEnv = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  env: Env,
) => effect.pipe(Effect.provideService(CloudflareEnvTag, env));

export const provideCloudflareRequestContext = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>,
  env: Env,
  ctx: ExecutionContext,
) =>
  effect.pipe(
    Effect.provideService(CloudflareEnvTag, env),
    Effect.provideService(CloudflareExecutionContextTag, ctx),
  );
