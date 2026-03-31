import { Context } from "effect";

// ── Effect Context.Tag (for handler code that uses Effect DI) ────

export interface CloudflareContextShape {
  readonly env: Env;
  readonly ctx: ExecutionContext;
}

export class CloudflareContext extends Context.Tag("api/CloudflareContext")<
  CloudflareContext,
  CloudflareContextShape
>() {}

// ── Module-level ref (for middleware, safe: Workers are single-threaded) ────

interface RequestState {
  env: Env | undefined;
  ctx: ExecutionContext | undefined;
}

const _state: RequestState = { env: undefined, ctx: undefined };

export const setRequestContext = (env: Env, ctx: ExecutionContext) => {
  _state.env = env;
  _state.ctx = ctx;
};

// eslint-disable-next-line typescript/no-non-null-assertion -- set in Worker.fetch before any handler runs
export const getEnv = (): Env => _state.env!;
// eslint-disable-next-line typescript/no-non-null-assertion -- set in Worker.fetch before any handler runs
export const getCtx = (): ExecutionContext => _state.ctx!;
