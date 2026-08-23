import { createKvSecondaryStorage } from "./secondary-storage";

interface StoredEntry {
  readonly value: string;
  readonly expirationTtl: number | undefined;
}

const createFakeKv = () => {
  const entries = new Map<string, StoredEntry>();
  return {
    entries,
    namespace: {
      get: async (key: string) => entries.get(key)?.value ?? null,
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
        entries.set(key, { value, expirationTtl: options?.expirationTtl });
      },
      delete: async (key: string) => {
        entries.delete(key);
      },
    } as unknown as KVNamespace,
  };
};

describe(createKvSecondaryStorage, () => {
  it("reads a value back and drops it in one call", async () => {
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);
    await storage.set("session", "token");

    await expect(storage.getAndDelete("session")).resolves.toBe("token");
    await expect(storage.get("session")).resolves.toBeNull();
  });

  it("returns null from getAndDelete for a key that is not there", async () => {
    const kv = createFakeKv();
    await expect(
      createKvSecondaryStorage(kv.namespace).getAndDelete("missing"),
    ).resolves.toBeNull();
  });

  it("counts up within the window", async () => {
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);

    await expect(storage.increment("ip:1", 10)).resolves.toBe(1);
    await expect(storage.increment("ip:1", 10)).resolves.toBe(2);
    await expect(storage.increment("ip:1", 10)).resolves.toBe(3);
  });

  it("starts a new window once the old one has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);

    await expect(storage.increment("ip:1", 10)).resolves.toBe(1);
    vi.advanceTimersByTime(9000);
    await expect(storage.increment("ip:1", 10)).resolves.toBe(2);
    vi.advanceTimersByTime(1001);
    await expect(storage.increment("ip:1", 10)).resolves.toBe(1);

    vi.useRealTimers();
  });

  // The window lives in the value, so it survives KV's 60s minimum expiration --
  // and the key must always outlive the window it is bookkeeping for.
  it("keeps the key alive at least as long as the window", async () => {
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);

    await storage.increment("short", 10);
    expect(kv.entries.get("short")?.expirationTtl).toBe(60);

    await storage.increment("long", 300);
    expect(kv.entries.get("long")?.expirationTtl).toBe(300);
  });

  // Re-writing without an expiration would clear the key's TTL and strand the
  // counter forever, so every increment must restate one.
  it("restates the expiration on every increment", async () => {
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);

    await storage.increment("ip:1", 10);
    await storage.increment("ip:1", 10);

    expect(kv.entries.get("ip:1")?.expirationTtl).toBe(60);
  });

  it("restarts the count when the stored value is unreadable", async () => {
    const kv = createFakeKv();
    const storage = createKvSecondaryStorage(kv.namespace);
    await storage.set("ip:1", "not json");

    await expect(storage.increment("ip:1", 10)).resolves.toBe(1);
  });
});
