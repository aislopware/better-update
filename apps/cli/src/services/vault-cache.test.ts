import { decodeCacheEntry, encodeCacheEntry, VAULT_CACHE_TTL_MS } from "./vault-cache";

import type { UnlockedVault } from "../application/vault-access";

const ORG = "org_acme";

const vault: UnlockedVault = {
  vaultKey: new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]),
  vaultVersion: 7,
  keyId: "key_abc123",
};

describe("vault-cache entry codec", () => {
  it("round-trips an unlocked vault and reports the remaining TTL", () => {
    const now = 1_000_000;
    const decoded = decodeCacheEntry(encodeCacheEntry(ORG, vault, now), now, ORG);
    expect(decoded).toBeDefined();
    expect([...decoded!.vault.vaultKey]).toStrictEqual([...vault.vaultKey]);
    expect(decoded!.vault.vaultVersion).toBe(vault.vaultVersion);
    expect(decoded!.vault.keyId).toBe(vault.keyId);
    expect(decoded!.remainingMs).toBe(VAULT_CACHE_TTL_MS);
  });

  it("stamps a custom TTL when one is provided", () => {
    const now = 1_000_000;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const decoded = decodeCacheEntry(encodeCacheEntry(ORG, vault, now, twoHoursMs), now, ORG);
    expect(decoded!.remainingMs).toBe(twoHoursMs);
  });

  it("counts down the remaining TTL as time passes", () => {
    const now = 1_000_000;
    const blob = encodeCacheEntry(ORG, vault, now);
    const decoded = decodeCacheEntry(blob, now + 60_000, ORG);
    expect(decoded!.remainingMs).toBe(VAULT_CACHE_TTL_MS - 60_000);
  });

  it("treats an entry at or past its expiry as missing", () => {
    const now = 1_000_000;
    const blob = encodeCacheEntry(ORG, vault, now, 5000);
    expect(decodeCacheEntry(blob, now + 5000, ORG)).toBeUndefined();
    expect(decodeCacheEntry(blob, now + 5001, ORG)).toBeUndefined();
    expect(decodeCacheEntry(blob, now + 4999, ORG)).toBeDefined();
  });

  it("treats malformed or wrong-shaped blobs as missing", () => {
    const now = 1_000_000;
    expect(decodeCacheEntry("not json", now, ORG)).toBeUndefined();
    expect(decodeCacheEntry(JSON.stringify({ vaultKey: "abc" }), now, ORG)).toBeUndefined();
    expect(
      decodeCacheEntry(
        JSON.stringify({ orgId: ORG, vaultKey: 1, vaultVersion: 1, keyId: "x", exp: 9 }),
        now,
        ORG,
      ),
    ).toBeUndefined();
  });

  // A device age key is user-scoped and shared across every org the user belongs
  // to, but each org has its OWN vault key. Handing org A's key back while org B
  // is active fails to unwrap on read and silently seals unreadable uploads on
  // write, so a foreign entry must read as a miss even if the account name were
  // derived wrongly.
  it("refuses an entry sealed for a different organization", () => {
    const now = 1_000_000;
    const blob = encodeCacheEntry("org_acme", vault, now);
    expect(decodeCacheEntry(blob, now, "org_globex")).toBeUndefined();
    expect(decodeCacheEntry(blob, now, "org_acme")).toBeDefined();
  });

  // Entries written before the org was recorded carry a real vault key but no way
  // to tell whose it is — they must never decode.
  it("refuses a pre-org entry that carries no organization", () => {
    const now = 1_000_000;
    const legacy = JSON.stringify({
      vaultKey: "AQIDBA==",
      vaultVersion: 7,
      keyId: "key_abc123",
      exp: now + VAULT_CACHE_TTL_MS,
    });
    expect(decodeCacheEntry(legacy, now, ORG)).toBeUndefined();
  });
});
