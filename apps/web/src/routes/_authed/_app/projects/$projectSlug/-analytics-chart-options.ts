import { ChartPalette } from "@better-update/ui/components/chart";

import type { KumoChartOption } from "@better-update/ui/components/chart";
import type { BarSeriesOption, PieSeriesOption } from "echarts/charts";

import { formatChartDate, formatChartTime } from "../../../../../lib/format-date";
import { compactNumber, numberFormatter } from "../../../../../lib/format-number";

// Overview-row cards share one fixed chart height so the grid stays level.
export const CHART_HEIGHT = 180;

// iOS ↔ the first categorical hue (blue) and Android ↔ the second (amber) — the
// same mapping every chart in the app uses; unexpected platforms take the next
// index along, so no two ever collide.
const PLATFORM_SERIES_INDEX: Record<string, number> = { ios: 0, android: 1 };

export const PLATFORM_LABELS: Record<string, string> = { ios: "iOS", android: "Android" };

export const platformColor = (platform: string, index: number, isDarkMode: boolean): string =>
  ChartPalette.categorical(PLATFORM_SERIES_INDEX[platform] ?? index + 2, isDarkMode);

/**
 * Traffic is bucketed hourly whatever the window, so an axis over several days
 * would otherwise repeat the same date under every tick. Only the tick that
 * opens a day carries it; the rest carry the hour. Kumo hands the formatter the
 * raw millisecond timestamp.
 */
export const axisTimestampFormat = (value: number): string => {
  const date = new Date(value);
  return date.getHours() === 0 ? formatChartDate(date) : formatChartTime(date);
};

/**
 * Ranked horizontal bars: the shape both the adoption and channel-health cards
 * want, and the one ECharts needs the most option plumbing for. Values sit at
 * the end of each bar rather than only in the tooltip, so the card reads
 * without hovering.
 */
export const rankedBarOptions = ({
  labels,
  values,
  seriesName,
  isDarkMode,
}: {
  labels: readonly string[];
  values: readonly number[];
  seriesName: string;
  isDarkMode: boolean;
}): KumoChartOption => {
  const axisText = ChartPalette.text("primary", isDarkMode);
  return {
    // ECharts 6 replaced `containLabel` with the outer-bounds model: "same"
    // + "axisLabel" is its exact equivalent, keeping the category labels
    // inside the padding rather than letting them overflow the canvas.
    grid: {
      left: 4,
      right: 44,
      top: 8,
      bottom: 4,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      axisLabel: { color: axisText, formatter: compactNumber },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { type: "dashed", color: axisText, opacity: 0.2 } },
    },
    yAxis: {
      type: "category",
      data: [...labels],
      // ECharts stacks categories bottom-up; both callers hand over a ranked
      // list, and a ranking reads top-down.
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisText },
    },
    series: [
      {
        name: seriesName,
        type: "bar",
        data: [...values],
        barMaxWidth: 16,
        itemStyle: {
          color: ChartPalette.categorical(0, isDarkMode),
          borderRadius: [0, 4, 4, 0],
        },
        label: {
          show: true,
          position: "right",
          color: axisText,
          fontSize: 11,
          formatter: (params) => numberFormatter.format(Number(params.value)),
        },
      } satisfies BarSeriesOption,
    ],
  };
};

/**
 * A ring rather than a full pie: the hole is where the total goes, which the
 * slices are a breakdown of.
 */
export const donutOptions = (
  slices: readonly { name: string; value: number; color: string }[],
): KumoChartOption => ({
  tooltip: { trigger: "item" },
  series: [
    {
      type: "pie",
      radius: ["62%", "88%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      data: slices.map((slice) => ({
        name: slice.name,
        value: slice.value,
        itemStyle: { color: slice.color },
      })),
    } satisfies PieSeriesOption,
  ],
});
