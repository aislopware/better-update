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

// eslint-disable-next-line typescript/no-non-null-assertion -- set in Worker.fetch before any handler runs
const getEnv = (): Env => _state.env!;
// eslint-disable-next-line typescript/no-non-null-assertion -- set in Worker.fetch before any handler runs
const getCtx = (): ExecutionContext => _state.ctx!;

// ── Effect accessors (for use inside adapters / middleware) ──────

/** Lazily reads the per-request Cloudflare `Env`. `R = never`. */
export const cloudflareEnv: Effect.Effect<Env> = Effect.sync(getEnv);

/** Lazily reads the per-request `ExecutionContext`. `R = never`. */
export const cloudflareCtx: Effect.Effect<ExecutionContext> = Effect.sync(getCtx);
