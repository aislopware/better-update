import { activityQueryOptions } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import { ChartPalette, TimeseriesChart } from "@better-update/ui/components/chart";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import type { ECharts } from "echarts/core";
import type { ReactNode } from "react";

import { ListPanel, ListPanelFooter, ListPanelHeader } from "../lib/data-table";
import { echarts } from "../lib/echarts";
import { formatChartDate } from "../lib/format-date";
import { compactNumber, numberFormatter } from "../lib/format-number";
import { useTheme } from "../lib/use-theme";

/**
 * How much shipping happened, day by day.
 *
 * The dashboard used to open on a row of tiles holding a single number each —
 * a lifetime count with nothing to compare it against, and a lot of white space
 * buying very little. A count only means something next to its own history, so
 * the number and the shape it came from live in one panel here: totals for the
 * window on the left, the daily bars underneath, and the trend against the
 * preceding stretch beside each figure.
 *
 * Sourced from published updates and builds rather than device telemetry, so it
 * has something to draw on a project nobody has installed yet.
 */

const PERIOD = "30d" as const;
const PERIOD_LABEL = "Last 30 days";
/** Half of the reporting window: the trend compares one half against the other. */
const TREND_WINDOW = 15;

export interface ActivityPoint {
  readonly date: string;
  readonly updates: number;
  readonly builds: number;
}

const sumOver = (points: readonly ActivityPoint[], key: "updates" | "builds"): number =>
  points.reduce((total, point) => total + point[key], 0);

/**
 * Percentage change between the two halves of the window, or `undefined` when
 * there is nothing to compare against — a jump from zero is not a percentage,
 * and claiming "+100%" for the first update ever published would be noise.
 * Exported for tests.
 */
export const trendPercent = (
  series: readonly ActivityPoint[],
  key: "updates" | "builds",
): number | undefined => {
  if (series.length < TREND_WINDOW * 2) {
    return undefined;
  }
  const earlier = sumOver(series.slice(-TREND_WINDOW * 2, -TREND_WINDOW), key);
  const recent = sumOver(series.slice(-TREND_WINDOW), key);
  return earlier === 0 ? undefined : Math.round(((recent - earlier) / earlier) * 100);
};

// Rising and falling are both ordinary here — shipping less this fortnight is
// not a fault — so the delta stays in the muted voice the rest of the strip
// uses, and only the arrow carries the direction.
const TrendChip = ({ percent }: { percent: number | undefined }) => {
  if (percent === undefined || percent === 0) {
    return null;
  }
  return (
    <span className="text-kumo-subtle text-xs tabular-nums">
      {percent > 0 ? "↑" : "↓"} {Math.abs(percent)}% vs previous {TREND_WINDOW} days
    </span>
  );
};

/**
 * One figure in the strip above the chart. The two that are drawn below carry
 * their series colour as a dot, which is what saves the chart from needing a
 * legend of its own — the number and the bars it came from are the same thing
 * said twice, so they should be labelled once.
 */
const Metric = ({
  label,
  value,
  trend,
  color,
}: {
  label: ReactNode;
  value: ReactNode;
  trend?: number | undefined;
  color?: string | undefined;
}) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="text-kumo-subtle flex items-center gap-1.5 text-xs">
      {color === undefined ? null : (
        // The palette hue comes from ECharts at runtime, so it cannot be a class.
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
    <span className="text-kumo-strong text-2xl leading-none font-semibold tabular-nums">
      {value}
    </span>
    <TrendChip percent={trend} />
  </div>
);

/** A standing count the caller carries in — how many, right now, of something. */
export interface ExtraMetric {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * One of those counts, in the closing band.
 *
 * These used to stand in the strip at the top in the same 2xl figures as the two
 * the chart is drawn from, so a panel headed "Last 30 days" opened on six equal
 * numbers of which only two belonged to the window — "Updates published 23" and
 * "Updates, all time 118" side by side, told apart only by their labels. A
 * standing count is not the headline, so it reads as an aside beneath the bars.
 */
const StandingFact = ({ label, value }: ExtraMetric) => (
  <span className="text-kumo-subtle flex items-center gap-1.5 text-xs">
    {label}
    <span className="text-kumo-default font-medium tabular-nums">{value}</span>
  </span>
);

const NO_EXTRAS: readonly ExtraMetric[] = [];

const CHART_HEIGHT = 176;

// Days are points on a real axis, so the bars sit where the calendar puts them
// and a quiet week is a visible gap rather than a missing label.
const toSeries = (
  series: readonly ActivityPoint[],
  key: "updates" | "builds",
): [number, number][] =>
  series.map((point) => [new Date(`${point.date}T00:00:00Z`).getTime(), point[key]]);

/** The two series' colours, resolved against the active theme. */
const useSeriesColors = (): { readonly updates: string; readonly builds: string } => {
  const isDarkMode = useTheme().resolvedTheme === "dark";
  return {
    updates: ChartPalette.categorical(0, isDarkMode),
    builds: ChartPalette.categorical(1, isDarkMode),
  };
};

/**
 * A month of daily counts, as stacked bars: a day is a discrete act of
 * publishing, and a bar per day says so.
 */
const ActivityChart = ({ series }: { series: readonly ActivityPoint[] }) => {
  const isDarkMode = useTheme().resolvedTheme === "dark";
  const colors = useSeriesColors();
  const chart = useRef<ECharts | null>(null);
  // A time axis labels the first of a month on top of the ticks it was asked
  // for, so a window crossing one printed "Aug 1" across "Aug 2". Dropping a
  // label that collides is the axis's own answer; Kumo does not expose it, so
  // it is merged into the instance the chart hands back — once, after Kumo's
  // own setOption, since a child's effects run before its parent's. Kumo merges
  // its later updates rather than replacing, so the axis keeps it.
  useMountEffect(() => {
    chart.current?.setOption({ xAxis: { axisLabel: { hideOverlap: true } } });
  });
  return (
    <TimeseriesChart
      ref={chart}
      echarts={echarts}
      type="bar"
      height={CHART_HEIGHT}
      isDarkMode={isDarkMode}
      data={[
        { name: "Updates", color: colors.updates, data: toSeries(series, "updates") },
        { name: "Builds", color: colors.builds, data: toSeries(series, "builds") },
      ]}
      xAxisTickCount={6}
      xAxisTickFormat={(value) => formatChartDate(new Date(value))}
      yAxisTickFormat={compactNumber}
      tooltipValueFormat={(value) => numberFormatter.format(value)}
      ariaDescription="Updates and builds published per day over the last 30 days."
    />
  );
};

const chartSkeleton = <Skeleton className="h-44 w-full rounded-md" />;

interface ActivityResult {
  readonly series: readonly ActivityPoint[];
  readonly totalUpdates: number;
  readonly totalBuilds: number;
}

/** The two figures the chart is drawn from, in the chart's own colours. */
const SeriesMetrics = ({
  data,
  isPending,
}: {
  data: ActivityResult | undefined;
  isPending: boolean;
}) => {
  const colors = useSeriesColors();
  const series = data?.series ?? [];
  const skeleton = <Skeleton className="h-6 w-12 rounded" />;
  return (
    <>
      <Metric
        label="Updates published"
        color={colors.updates}
        value={isPending ? skeleton : (data?.totalUpdates ?? 0)}
        trend={trendPercent(series, "updates")}
      />
      <Metric
        label="Builds uploaded"
        color={colors.builds}
        value={isPending ? skeleton : (data?.totalBuilds ?? 0)}
        trend={trendPercent(series, "builds")}
      />
    </>
  );
};

/**
 * Panel form: the header names the window, the strip carries its totals, the
 * bars carry their shape, and whatever standing counts the caller passes close
 * the panel underneath. Used at the top of the org and project overviews, where
 * the row of single-number tiles used to sit.
 */
export const ShippingActivityPanel = ({
  orgId,
  projectId,
  title = "Shipping activity",
  extras = NO_EXTRAS,
  actions,
}: {
  orgId: string;
  /** Omit for the whole organization. */
  projectId?: string | undefined;
  title?: string;
  extras?: readonly ExtraMetric[];
  actions?: ReactNode;
}) => {
  const { data, isPending } = useQuery(activityQueryOptions(orgId, projectId, PERIOD));
  const series = data?.series ?? [];

  return (
    <ListPanel>
      <ListPanelHeader title={title} description={PERIOD_LABEL} actions={actions} />
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <SeriesMetrics data={data} isPending={isPending} />
        </div>
        {isPending ? chartSkeleton : <ActivityChart series={series} />}
      </div>
      {extras.length > 0 ? (
        <ListPanelFooter>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {extras.map((extra) => (
              <StandingFact key={extra.label} label={extra.label} value={extra.value} />
            ))}
          </div>
        </ListPanelFooter>
      ) : null}
    </ListPanel>
  );
};
