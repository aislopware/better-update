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

export interface ProjectActivityPoint extends ActivityPoint {
  readonly projectId: string;
}

export interface ProjectActivitySeries {
  readonly projectId: string;
  readonly series: readonly ActivityPoint[];
  readonly totalUpdates: number;
  readonly totalBuilds: number;
}

/**
 * Folds partial points onto one row per day. Updates and builds are counted by
 * separate queries, so a day that saw both arrives as two rows carrying one
 * count each — and `densifyActivity` keys by date, so whichever landed second
 * would otherwise stand for the day alone.
 */
const sumByDay = (points: readonly ActivityPoint[]): readonly ActivityPoint[] => [
  ...points
    .reduce((byDay, point) => {
      const seen = byDay.get(point.date);
      return byDay.set(
        point.date,
        seen
          ? {
              date: point.date,
              updates: seen.updates + point.updates,
              builds: seen.builds + point.builds,
            }
          : { date: point.date, updates: point.updates, builds: point.builds },
      );
    }, new Map<string, ActivityPoint>())
    .values(),
];

/**
 * The same padding, applied per project.
 *
 * Only projects the rows mention come back. A project with nothing in the window
 * is absent rather than a run of zeros: the caller knows which projects it asked
 * about, and thirty zeros per silent project is most of the response on an
 * organization that ships from two of its twenty.
 */
export const groupProjectActivity = (
  rows: readonly ProjectActivityPoint[],
  now: Date,
  period: AnalyticsPeriod | undefined,
): readonly ProjectActivitySeries[] => {
  const byProject = rows.reduce((acc, row) => {
    acc.set(row.projectId, [...(acc.get(row.projectId) ?? []), row]);
    return acc;
  }, new Map<string, ProjectActivityPoint[]>());

  return [...byProject].map(([projectId, projectRows]) => {
    const series = densifyActivity(sumByDay(projectRows), now, period);
    return {
      projectId,
      series,
      totalUpdates: series.reduce((sum, point) => sum + point.updates, 0),
      totalBuilds: series.reduce((sum, point) => sum + point.builds, 0),
    };
  });
};
