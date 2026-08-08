import { densifyActivity, periodStart, toDayKey } from "./activity-series";

const NOW = new Date("2026-08-08T11:30:00.000Z");

describe(periodStart, () => {
  it("counts today as the last day of the window", () => {
    expect(toDayKey(periodStart(NOW, "7d"))).toBe("2026-08-02");
  });

  it("collapses to today for a one-day window", () => {
    expect(toDayKey(periodStart(NOW, "1d"))).toBe("2026-08-08");
  });

  it("defaults to a week when no period is given", () => {
    expect(toDayKey(periodStart(NOW, undefined))).toBe("2026-08-02");
  });
});

describe(densifyActivity, () => {
  it("fills quiet days with zeros so gaps stay visible", () => {
    const series = densifyActivity(
      [
        { date: "2026-08-03", updates: 2, builds: 1 },
        { date: "2026-08-08", updates: 5, builds: 0 },
      ],
      NOW,
      "7d",
    );

    expect(series).toHaveLength(7);
    expect(series.map((point) => point.date)).toStrictEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
    ]);
    expect(series[1]).toStrictEqual({ date: "2026-08-03", updates: 2, builds: 1 });
    expect(series[2]).toStrictEqual({ date: "2026-08-04", updates: 0, builds: 0 });
  });

  it("drops rows that fall outside the window", () => {
    const series = densifyActivity([{ date: "2026-07-01", updates: 9, builds: 9 }], NOW, "7d");

    expect(series.every((point) => point.updates === 0 && point.builds === 0)).toBe(true);
  });

  it("spans the full window for a long period", () => {
    expect(densifyActivity([], NOW, "90d")).toHaveLength(90);
  });
});
