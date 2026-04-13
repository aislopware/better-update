import { Effect } from "effect";

// ── Module-level ref (safe: Workers are single-threaded) ────────

interface RequestState {
  env: Env | undefined;
  ctx: ExecutionContext | undefined;
}

const _state: RequestState = { env: undefined, ctx: undefined };

export const setRequestContext = (env: Env, ctx: ExecutionContext) => {
  _state.env = env;
  _state.ctx = ctx;
};

const requireValue = <T>(value: T | undefined, label: string): Effect.Effect<T> =>
  value === undefined ? Effect.dieMessage(`${label} is not set`) : Effect.succeed(value);

// ── Effect accessors (for use inside adapters / middleware) ──────

/** Lazily reads the per-request Cloudflare `Env`. `R = never`. */
export const cloudflareEnv: Effect.Effect<Env> = Effect.suspend(() =>
  requireValue(_state.env, "Cloudflare env"),
);

/** Lazily reads the per-request `ExecutionContext`. `R = never`. */
export const cloudflareCtx: Effect.Effect<ExecutionContext> = Effect.suspend(() =>
  requireValue(_state.ctx, "Cloudflare execution context"),
);
