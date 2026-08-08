import type { AnalyticsPeriod } from "../models";

export interface ActivityPoint {
  readonly date: string;
  readonly updates: number;
  readonly builds: number;
}

const PERIOD_TO_DAYS: Record<AnalyticsPeriod, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const DAY_MS = 86_400_000;

/** Calendar day of an instant, UTC, as `YYYY-MM-DD`. */
export const toDayKey = (at: Date): string => at.toISOString().slice(0, 10);

export const periodDays = (period: AnalyticsPeriod | undefined): number =>
  PERIOD_TO_DAYS[period ?? "7d"];

/**
 * First day the period covers, counting `now` as the last one — a 7-day period
 * is the last seven days including today, not today plus seven before it.
 */
export const periodStart = (now: Date, period: AnalyticsPeriod | undefined): Date =>
  new Date(now.getTime() - (periodDays(period) - 1) * DAY_MS);

/**
 * Pads a sparse day→counts result out to every day in the window.
 *
 * A chart drawn straight from grouped rows lies about quiet stretches: three
 * rows a fortnight apart plot as three evenly spaced points, which reads as
 * steady shipping. The zeros have to be in the data for the gap to be visible.
 */
export const densifyActivity = (
  rows: readonly ActivityPoint[],
  now: Date,
  period: AnalyticsPeriod | undefined,
): readonly ActivityPoint[] => {
  const byDate = new Map(rows.map((row) => [row.date, row] as const));
  const start = periodStart(now, period);
  return Array.from({ length: periodDays(period) }, (_unused, index) => {
    const date = toDayKey(new Date(start.getTime() + index * DAY_MS));
    return byDate.get(date) ?? { date, updates: 0, builds: 0 };
  });
};
