import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";

// Workers KV rejects an `expirationTtl` below 60 seconds.
const KV_MIN_EXPIRATION_TTL_SECONDS = 60;

/**
 * One rate-limit counter as stored in KV. The window start rides along with the
 * count because KV cannot expire a key faster than 60s while Better Auth's
 * default window is 10s, so the key's expiration cannot be the window.
 */
interface RateLimitCounter {
  readonly count: number;
  readonly startedAt: number;
}

const readRateLimitCounter = (raw: string | null): RateLimitCounter | undefined => {
  const parsed = raw === null ? undefined : safeJsonParse(raw);
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { count, startedAt } = parsed;
  return typeof count === "number" && typeof startedAt === "number"
    ? { count, startedAt }
    : undefined;
};

/**
 * Better Auth's secondary storage (sessions, cookie cache, rate-limit counters)
 * backed by Workers KV.
 *
 * KV has no atomic read-modify-write, so `getAndDelete` and `increment` are the
 * same read-then-write Better Auth composed itself before 1.7 asked storage for
 * them: nothing is lost relative to 1.6, and nothing more can be gained without
 * moving the counters into a Durable Object.
 */
export const createKvSecondaryStorage = (kv: KVNamespace) => ({
  get: async (key: string) => kv.get(key),
  set: async (key: string, value: string, ttl?: number) =>
    kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
  delete: async (key: string) => kv.delete(key),
  getAndDelete: async (key: string) => {
    const value = await kv.get(key);
    await kv.delete(key);
    return value;
  },
  /**
   * Rate limiting only, and its key is never read back through `get`. The window
   * is enforced by `startedAt` in the value; the key's expiration is left as
   * garbage collection, floored at KV's 60s minimum and never shorter than the
   * window it has to outlive.
   */
  increment: async (key: string, ttl: number) => {
    const now = Date.now();
    const current = readRateLimitCounter(await kv.get(key));
    const inWindow = current !== undefined && now - current.startedAt < ttl * 1000;
    const counter: RateLimitCounter = inWindow
      ? { count: current.count + 1, startedAt: current.startedAt }
      : { count: 1, startedAt: now };
    await kv.put(key, JSON.stringify(counter), {
      expirationTtl: Math.max(ttl, KV_MIN_EXPIRATION_TTL_SECONDS),
    });
    return counter.count;
  },
});
