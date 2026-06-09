import { Context, Effect, Option } from "effect";

export class CloudflareEnvTag extends Context.Tag("server/CloudflareEnv")<
  CloudflareEnvTag,
  Env
>() {}
/**
 * The per-request D1 session. Created once at the request boundary via
 * `env.DB.withSession(...)` so every query in the request shares one bookmark,
 * giving sequential consistency / read-your-writes across read replicas. Safe
 * when replication is disabled — D1 then routes the session to the primary.
 */
export class D1SessionTag extends Context.Tag("server/D1Session")<
  D1SessionTag,
  D1DatabaseSession
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

export const d1Session: Effect.Effect<D1DatabaseSession> = fromFiberContext(
  D1SessionTag,
  "D1 session",
);

/**
 * Open a D1 session anchored at the given constraint or bookmark. `undefined`
 * defaults to `"first-unconstrained"` (the session's first query may hit any
 * replica; writes still go to the primary, and the session keeps reads
 * consistent with everything it has already done).
 */
export const makeD1Session = (
  env: Env,
  // A bookmark (opaque string) to resume a client's prior consistency, or a
  // `"first-primary"` / `"first-unconstrained"` constraint. Both are strings to
  // D1, so the parameter is typed as the bookmark alias.
  constraintOrBookmark?: D1SessionBookmark,
): D1DatabaseSession => env.DB.withSession(constraintOrBookmark ?? "first-unconstrained");

export const makeCloudflareRequestContext = (
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  session: D1DatabaseSession,
) =>
  Context.make(CloudflareEnvTag, env).pipe(
    Context.add(CloudflareExecutionContextTag, ctx),
    Context.add(CloudflareRequestTag, request),
    Context.add(D1SessionTag, session),
  );

export const provideCloudflareEnv = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  env: Env,
  session: D1DatabaseSession = makeD1Session(env),
) =>
  effect.pipe(
    Effect.provideService(CloudflareEnvTag, env),
    Effect.provideService(D1SessionTag, session),
  );

export const provideCloudflareRequestContext = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  session: D1DatabaseSession = makeD1Session(env),
) =>
  effect.pipe(
    Effect.provideService(CloudflareEnvTag, env),
    Effect.provideService(CloudflareExecutionContextTag, ctx),
    Effect.provideService(CloudflareRequestTag, request),
    Effect.provideService(D1SessionTag, session),
  );
