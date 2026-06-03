import { Context, Effect, Option } from "effect";

export class CloudflareEnvTag extends Context.Tag("server/CloudflareEnv")<
  CloudflareEnvTag,
  Env
>() {}
class CloudflareExecutionContextTag extends Context.Tag("server/CloudflareExecutionContext")<
  CloudflareExecutionContextTag,
  ExecutionContext
>() {}
class CloudflareRequestTag extends Context.Tag("server/CloudflareRequest")<
  CloudflareRequestTag,
  Request
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

export const cloudflareRequest: Effect.Effect<Request> = fromFiberContext(
  CloudflareRequestTag,
  "Cloudflare request",
);

export const makeCloudflareRequestContext = (env: Env, ctx: ExecutionContext, request: Request) =>
  Context.make(CloudflareEnvTag, env).pipe(
    Context.add(CloudflareExecutionContextTag, ctx),
    Context.add(CloudflareRequestTag, request),
  );

export const provideCloudflareEnv = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  env: Env,
) => effect.pipe(Effect.provideService(CloudflareEnvTag, env));

export const provideCloudflareRequestContext = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  env: Env,
  ctx: ExecutionContext,
  request: Request,
) =>
  effect.pipe(
    Effect.provideService(CloudflareEnvTag, env),
    Effect.provideService(CloudflareExecutionContextTag, ctx),
    Effect.provideService(CloudflareRequestTag, request),
  );
