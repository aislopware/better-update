import { hashToFraction } from "./hash";

describe(hashToFraction, () => {
  test("is deterministic for same inputs", async () => {
    const first = await hashToFraction("salt-1", "client-1");
    const second = await hashToFraction("salt-1", "client-1");
    expect(first).toBe(second);
  });

  test("returns a value in [0, 1)", async () => {
    const salts = ["s1", "s2", "s3", "s4", "s5"];
    const results = await Promise.all(salts.map(async (salt) => hashToFraction(salt, "client")));
    for (const result of results) {
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1);
    }
  });

  test("different salts produce different fractions", async () => {
    const saltA = await hashToFraction("salt-a", "client");
    const saltB = await hashToFraction("salt-b", "client");
    expect(saltA).not.toBe(saltB);
  });

  test("different client IDs produce different fractions", async () => {
    const clientA = await hashToFraction("salt", "client-a");
    const clientB = await hashToFraction("salt", "client-b");
    expect(clientA).not.toBe(clientB);
  });
});
