import { desktopAnalyticsQueryOptions } from "@better-update/api-client/react";
import { Chart } from "@better-update/ui/components/chart";
import { useSuspenseQuery } from "@tanstack/react-query";

import { echarts } from "../../../../../lib/echarts";
import { formatBytes } from "../../../../../lib/format-bytes";
import { numberFormatter } from "../../../../../lib/format-number";
import {
  CHART_HEIGHT,
  PLATFORM_LABELS,
  rankedBarOptions,
  UPDATER_LABELS,
} from "./-analytics-chart-options";
import { ChartUnavailableState, useIsDarkMode } from "./-analytics-charts";

import type { AnalyticsPeriod } from "./-analytics-charts";

/**
 * Desktop apps polling the update feeds: what versions are out there (from the
 * updaters that say — Sparkle, WinSparkle, Electron; Tauri when its endpoint
 * passes `{{current_version}}`), else which updaters ask.
 */
export const DesktopUpdatesChart = ({
  orgId,
  projectId,
  period,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(desktopAnalyticsQueryOptions(orgId, projectId, period));
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  const downloads = data.releases.reduce((total, release) => total + release.downloads, 0);
  const bytes = data.releases.reduce((total, release) => total + release.bytes, 0);
  const byVersion = data.clientVersions.length > 0;
  const rows = byVersion
    ? data.clientVersions.map((entry) => ({
        label: `${PLATFORM_LABELS[entry.platform] ?? entry.platform} ${entry.version}`,
        value: entry.checks,
      }))
    : data.updaters.map((entry) => ({
        label: `${PLATFORM_LABELS[entry.platform] ?? entry.platform} · ${UPDATER_LABELS[entry.updater] ?? entry.updater}`,
        value: entry.checks,
      }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-kumo-subtle text-sm">
        {numberFormatter.format(data.checks)} checks
        {data.installs > 0
          ? ` · ${numberFormatter.format(data.installs)} installs`
          : ""} &middot;{" "}
        {numberFormatter.format(downloads)} downloads &middot; {formatBytes(bytes)} served
      </p>
      {rows.length > 0 ? (
        <Chart
          echarts={echarts}
          height={CHART_HEIGHT}
          isDarkMode={isDarkMode}
          options={rankedBarOptions({
            labels: rows.map((row) => row.label),
            values: rows.map((row) => row.value),
            seriesName: byVersion ? "Checks by app version" : "Checks by updater",
            isDarkMode,
          })}
        />
      ) : null}
    </div>
  );
};
