import { trendPercent } from "./shipping-activity";

import type { ActivityPoint } from "./shipping-activity";

const point = (date: string, updates: number, builds = 0): ActivityPoint => ({
  date,
  updates,
  builds,
});

// A full 30-day window: the first 15 days, then the last 15.
const window30 = (earlier: readonly number[], recent: readonly number[]): ActivityPoint[] =>
  [...earlier, ...recent].map((count, index) => point(`2026-07-${String(index + 1)}`, count));

const flat = (count: number): readonly number[] => Array.from({ length: 15 }, () => count);

describe(trendPercent, () => {
  it("compares the recent half against the earlier one", () => {
    expect(trendPercent(window30(flat(2), flat(3)), "updates")).toBe(50);
  });

  it("reports a fall as a negative percentage", () => {
    expect(trendPercent(window30(flat(4), flat(1)), "updates")).toBe(-75);
  });

  it("has nothing to compare when the earlier half is empty", () => {
    expect(trendPercent(window30(flat(0), flat(5)), "updates")).toBeUndefined();
  });

  it("stays quiet on a window too short to halve", () => {
    expect(trendPercent([point("2026-07-01", 3)], "updates")).toBeUndefined();
  });

  it("reads the series the caller asked for", () => {
    const series = window30(flat(1), flat(1)).map((entry, index) =>
      point(entry.date, entry.updates, index < 15 ? 1 : 2),
    );

    expect(trendPercent(series, "updates")).toBe(0);
    expect(trendPercent(series, "builds")).toBe(100);
  });
});
