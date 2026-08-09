import { addDays, subDays } from "date-fns";

import { expiryRollupMessage } from "./-credentials-expiry-rollup";

const NOW = new Date("2026-08-09T00:00:00.000Z");

const at = (days: number) => ({
  validUntil: (days < 0 ? subDays(NOW, -days) : addDays(NOW, days)).toISOString(),
});

describe(expiryRollupMessage, () => {
  it("says nothing when every credential is comfortably valid", () => {
    expect(expiryRollupMessage([at(90), at(365), { validUntil: null }], NOW)).toBeNull();
  });

  it("counts an expired credential in the singular", () => {
    expect(expiryRollupMessage([at(-1), at(365)], NOW)).toBe("1 credential has expired");
  });

  it("reports both buckets, expired first", () => {
    expect(expiryRollupMessage([at(-1), at(-30), at(10), at(365)], NOW)).toBe(
      "2 credentials have expired · 1 credential expires within 30 days",
    );
  });

  // Keystores uploaded before the CLI recorded an expiry carry null, which is
  // "unknown", not "expired" — counting them would cry wolf on every page load.
  it("ignores credentials with no expiry at all", () => {
    expect(expiryRollupMessage([{ validUntil: null }, { validUntil: null }], NOW)).toBeNull();
  });

  it("counts an Android keystore the same as an Apple certificate", () => {
    expect(expiryRollupMessage([at(-2)], NOW)).toBe("1 credential has expired");
  });
});
