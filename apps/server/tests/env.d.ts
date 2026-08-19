/**
 * Bindings that only exist while the suite runs. `vitest.config.ts` injects
 * `TEST_MIGRATIONS` into the pool's miniflare env so `setup-d1.ts` can replay
 * the real migration files against each isolated D1 instance; it is never part
 * of a deployed Worker, so `wrangler types` cannot know about it.
 *
 * Declared on `Cloudflare.Env` rather than the global `Env` because that is what
 * `cloudflare:test` types its `env` export as — and keeping the global `Env`
 * free of it is what lets that same `env` still be handed to worker code.
 */
declare namespace Cloudflare {
  interface Env {
    readonly TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
