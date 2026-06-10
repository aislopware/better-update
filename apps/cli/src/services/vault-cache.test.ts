import { decodeCacheEntry, encodeCacheEntry, VAULT_CACHE_TTL_MS } from "./vault-cache";

import type { UnlockedVault } from "../application/vault-access";

const vault: UnlockedVault = {
  vaultKey: new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]),
  vaultVersion: 7,
  keyId: "key_abc123",
};

describe("vault-cache entry codec", () => {
  it("round-trips an unlocked vault and reports the remaining TTL", () => {
    const now = 1_000_000;
    const decoded = decodeCacheEntry(encodeCacheEntry(vault, now), now);
    expect(decoded).toBeDefined();
    expect([...decoded!.vault.vaultKey]).toStrictEqual([...vault.vaultKey]);
    expect(decoded!.vault.vaultVersion).toBe(vault.vaultVersion);
    expect(decoded!.vault.keyId).toBe(vault.keyId);
    expect(decoded!.remainingMs).toBe(VAULT_CACHE_TTL_MS);
  });

  it("stamps a custom TTL when one is provided", () => {
    const now = 1_000_000;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const decoded = decodeCacheEntry(encodeCacheEntry(vault, now, twoHoursMs), now);
    expect(decoded!.remainingMs).toBe(twoHoursMs);
  });

  it("counts down the remaining TTL as time passes", () => {
    const now = 1_000_000;
    const blob = encodeCacheEntry(vault, now);
    const decoded = decodeCacheEntry(blob, now + 60_000);
    expect(decoded!.remainingMs).toBe(VAULT_CACHE_TTL_MS - 60_000);
  });

  it("treats an entry at or past its expiry as missing", () => {
    const now = 1_000_000;
    const blob = encodeCacheEntry(vault, now, 5000);
    expect(decodeCacheEntry(blob, now + 5000)).toBeUndefined();
    expect(decodeCacheEntry(blob, now + 5001)).toBeUndefined();
    expect(decodeCacheEntry(blob, now + 4999)).toBeDefined();
  });

  it("treats malformed or wrong-shaped blobs as missing", () => {
    const now = 1_000_000;
    expect(decodeCacheEntry("not json", now)).toBeUndefined();
    expect(decodeCacheEntry(JSON.stringify({ vaultKey: "abc" }), now)).toBeUndefined();
    expect(
      decodeCacheEntry(JSON.stringify({ vaultKey: 1, vaultVersion: 1, keyId: "x", exp: 9 }), now),
    ).toBeUndefined();
  });
});
