import { resolveUpdateRollout } from "./update-rollout";

// Pre-computed hash fractions (SHA-256, deterministic):
//   HashToFraction("update-1", "client-c")  ≈ 0.2048  → below 0.50 (in 50% rollout)
//   HashToFraction("update-1", "client-a")  ≈ 0.7523  → above 0.50 (not in 50% rollout)
//   HashToFraction("update-0", "device-5")  ≈ 0.0313  → below 0.30 (in 30% rollout)
//   HashToFraction("update-0", "client-a")  ≈ 0.3240  → above 0.30 (not in 30% rollout)

const candidate = (id: string, rollout: number) => ({ id, rollout_percentage: rollout });

describe(resolveUpdateRollout, () => {
  test("returns null for empty candidates", async () => {
    const result = await resolveUpdateRollout([], "client-c");
    expect(result).toBeNull();
  });

  test("single candidate at 100% resolves immediately", async () => {
    const result = await resolveUpdateRollout([candidate("update-1", 100)], "client-c");
    expect(result).toEqual({ resolved: true, update: candidate("update-1", 100) });
  });

  test("latest at 0% with previous at 100% resolves to previous", async () => {
    const result = await resolveUpdateRollout(
      [candidate("update-1", 0), candidate("update-0", 100)],
      "client-c",
    );
    expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
  });

  test("latest at 0% with no previous returns no-update", async () => {
    const result = await resolveUpdateRollout([candidate("update-1", 0)], "client-c");
    expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
  });

  test("latest at 0% with previous at 0% needs fallback query", async () => {
    const result = await resolveUpdateRollout(
      [candidate("update-1", 0), candidate("update-0", 0)],
      "client-c",
    );
    expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
  });

  test("latest at 50%, device in rollout resolves to latest", async () => {
    // Client-c hashes to ≈0.2048 for update-1, which is < 0.50
    const result = await resolveUpdateRollout([candidate("update-1", 50)], "client-c");
    expect(result).toEqual({ resolved: true, update: candidate("update-1", 50) });
  });

  test("latest at 50%, device not in rollout, previous at 100% resolves to previous", async () => {
    // Client-a hashes to ≈0.7523 for update-1, which is > 0.50
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 100)],
      "client-a",
    );
    expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
  });

  test("latest at 50%, device not in rollout, no previous returns no-update", async () => {
    const result = await resolveUpdateRollout([candidate("update-1", 50)], "client-a");
    expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
  });

  test("latest at 50%, no easClientId falls back to previous", async () => {
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 100)],
      undefined,
    );
    expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
  });

  test("latest at 50%, no easClientId, previous at 30% serves previous directly", async () => {
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 30)],
      undefined,
    );
    expect(result).toEqual({ resolved: true, update: candidate("update-0", 30) });
  });

  test("latest at 50%, no easClientId, no previous returns no-update", async () => {
    const result = await resolveUpdateRollout([candidate("update-1", 50)], undefined);
    expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
  });

  test("latest at 50%, device not in rollout, previous at 0% needs fallback query", async () => {
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 0)],
      "client-a",
    );
    expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
  });

  test("latest at 50%, device not in rollout, previous at 30%, device in prev resolves to previous", async () => {
    // Device-5: latest ≈0.8974 (>0.50 = not in), prev ≈0.0313 (<0.30 = in)
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 30)],
      "device-5",
    );
    expect(result).toEqual({ resolved: true, update: candidate("update-0", 30) });
  });

  test("latest at 50%, device not in rollout, previous at 30%, device not in prev needs fallback query", async () => {
    // Client-a: latest ≈0.7523 (>0.50 = not in), prev ≈0.3240 (>0.30 = not in)
    const result = await resolveUpdateRollout(
      [candidate("update-1", 50), candidate("update-0", 30)],
      "client-a",
    );
    expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
  });
});
