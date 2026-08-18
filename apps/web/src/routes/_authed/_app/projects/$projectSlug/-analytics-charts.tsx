import {
  adoptionQueryOptions,
  channelAnalyticsQueryOptions,
  channelsQueryOptions,
  deliveryAnalyticsQueryOptions,
  platformAnalyticsQueryOptions,
  updateAnalyticsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  Chart,
  ChartLegend,
  ChartPalette,
  TimeseriesChart,
} from "@better-update/ui/components/chart";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../../../components/server-search-combobox";
import { echarts } from "../../../../../lib/echarts";
import { formatBytes } from "../../../../../lib/format-bytes";
import { compactNumber, numberFormatter, percentFormatter } from "../../../../../lib/format-number";
import { truncateId } from "../../../../../lib/truncate-id";
import { useTheme } from "../../../../../lib/use-theme";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
import {
  axisTimestampFormat,
  CHART_HEIGHT,
  donutOptions,
  PLATFORM_LABELS,
  platformColor,
  rankedBarOptions,
} from "./-analytics-chart-options";

export const PERIODS = ["1d", "7d", "30d", "90d"] as const;

export const PERIOD_LABELS: Record<string, string> = {
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export type AnalyticsPeriod = (typeof PERIODS)[number];

const useIsDarkMode = (): boolean => useTheme().resolvedTheme === "dark";

export const chartSkeleton = <Skeleton className="h-45 w-full rounded-md" />;

// Prefer the human message over an opaque id in the update picker.
const updateLabel = (updateItem: { readonly id: string; readonly message: string }) =>
  updateItem.message || truncateId(updateItem.id);

// Only as tall as the sentence needs. Holding the chart's full height open for a
// card with nothing in it turns an empty section into a page of empty boxes —
// the cards in a row shrink together, so the grid stays level either way.
const ChartEmptyState = ({ message }: { message: string }) => (
  <p className="text-kumo-subtle flex items-center justify-center py-6 text-center text-sm">
    {message}
  </p>
);

/**
 * The server answered, but could not reach Analytics Engine — the zeros below
 * mean "not asked", not "not found". Worth its own sentence: a wrong reading of
 * this one sends people hunting for a traffic problem they do not have.
 */
export const ANALYTICS_UNAVAILABLE_MESSAGE =
  "Analytics unavailable — the server could not query Cloudflare Analytics Engine.";

const ChartUnavailableState = () => <ChartEmptyState message={ANALYTICS_UNAVAILABLE_MESSAGE} />;

/**
 * What the section can draw, decided once for all four cards.
 *
 * `unavailable` is the read path being down; `empty` is the far more common
 * case of a project no device has checked into yet. Reads the same cache keys
 * as the adoption and platform charts below, so asking a beat early costs no
 * extra request — and it lets the section say it once instead of four times.
 */
export type AnalyticsStatus = "unavailable" | "empty" | "ready";

export const useAnalyticsStatus = (
  orgId: string,
  projectId: string,
  period: AnalyticsPeriod,
): AnalyticsStatus =>
  useSuspenseQueries({
    queries: [
      adoptionQueryOptions(orgId, projectId, period),
      platformAnalyticsQueryOptions(orgId, projectId, period),
    ],
    combine: ([adoption, platform]) => {
      if (adoption.data.unavailable || platform.data.unavailable) {
        return "unavailable";
      }
      return adoption.data.updates.length > 0 || platform.data.platforms.length > 0
        ? "ready"
        : "empty";
    },
  });

const ChartSummary = ({ requests, devices }: { requests: number; devices: number }) => (
  <p className="text-kumo-subtle text-sm">
    {numberFormatter.format(requests)} requests &middot; {numberFormatter.format(devices)} unique
    devices
  </p>
);

export const AdoptionChart = ({
  orgId,
  projectId,
  period,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(adoptionQueryOptions(orgId, projectId, period));
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  if (data.updates.length === 0) {
    return (
      <ChartEmptyState message="No analytics yet — data appears once devices check for updates." />
    );
  }

  return (
    <Chart
      echarts={echarts}
      height={CHART_HEIGHT}
      isDarkMode={isDarkMode}
      options={rankedBarOptions({
        labels: data.updates.map((entry) => truncateId(entry.updateId)),
        values: data.updates.map((entry) => entry.devices),
        seriesName: "Devices",
        isDarkMode,
      })}
    />
  );
};

export const PlatformChart = ({
  orgId,
  projectId,
  period,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(platformAnalyticsQueryOptions(orgId, projectId, period));
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  if (data.platforms.length === 0) {
    return (
      <ChartEmptyState message="No analytics yet — data appears once devices check for updates." />
    );
  }

  const slices = data.platforms.map((entry, index) => ({
    name: PLATFORM_LABELS[entry.platform] ?? entry.platform,
    value: entry.devices,
    color: platformColor(entry.platform, index, isDarkMode),
  }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Chart
          echarts={echarts}
          height={CHART_HEIGHT}
          isDarkMode={isDarkMode}
          options={donutOptions(slices)}
        />
        {/* The hole is the obvious place for the number the ring is a
            breakdown of, and ECharts has no way to put it there. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-kumo-strong text-xl font-semibold tabular-nums">
            {numberFormatter.format(total)}
          </span>
          <span className="text-kumo-subtle text-xs">devices</span>
        </div>
      </div>
      {/* Counts, not just names: the ring shows proportion, the legend the
          figures behind it. */}
      <div className="divide-kumo-hairline flex flex-wrap justify-center gap-x-4 divide-x">
        {slices.map((slice) => (
          <ChartLegend.SmallItem
            key={slice.name}
            name={slice.name}
            color={slice.color}
            value={numberFormatter.format(slice.value)}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * What the bundle route served, which the manifest charts above cannot show: a
 * device that checks and is already current downloads nothing, and one that
 * does download takes either a bsdiff patch or the whole bundle.
 */
export const DeliveryChart = ({
  orgId,
  projectId,
  period,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(deliveryAnalyticsQueryOptions(orgId, projectId, period));
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  if (data.downloads === 0 && data.notFound === 0) {
    return (
      <ChartEmptyState message="No bundle downloads yet — data appears once devices install an update." />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-kumo-subtle text-sm">
        {numberFormatter.format(data.downloads)} downloads &middot; {formatBytes(data.bytesServed)}{" "}
        served
        {data.patchEligibleRequests > 0
          ? ` · ${percentFormatter.format(data.patchDownloads / data.patchEligibleRequests)} patched`
          : ""}
      </p>
      <Chart
        echarts={echarts}
        height={CHART_HEIGHT}
        isDarkMode={isDarkMode}
        options={rankedBarOptions({
          labels: ["Patch", "Full bundle", "Not found"],
          values: [data.patchDownloads, data.fullDownloads, data.notFound],
          seriesName: "Requests",
          isDarkMode,
        })}
      />
    </div>
  );
};

const ChannelHealthInner = ({
  orgId,
  projectId,
  channel,
  period,
}: {
  orgId: string;
  projectId: string;
  channel: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(
    channelAnalyticsQueryOptions(orgId, projectId, channel, period),
  );
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  if (data.totalRequests === 0) {
    return (
      <ChartEmptyState message="No requests on this channel yet — data appears once devices check for updates." />
    );
  }

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      <Chart
        echarts={echarts}
        height={CHART_HEIGHT}
        isDarkMode={isDarkMode}
        options={rankedBarOptions({
          labels: ["Manifest", "Directive", "No update"],
          values: [
            data.responseTypeDistribution.manifest,
            data.responseTypeDistribution.directive,
            data.responseTypeDistribution.no_update,
          ],
          seriesName: "Requests",
          isDarkMode,
        })}
      />
    </>
  );
};

export const ChannelHealthChart = ({
  orgId,
  projectId,
  period,
  channel,
  onChannelChange,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
  channel: string | undefined;
  onChannelChange: (next: string) => void;
}) => {
  const list = useServerSearchList((query) =>
    channelsQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );
  // Same cache key as the hook's default query, so this suspends without an
  // extra fetch; fallback + empty state stay pinned to the default list.
  const { data: channelsData } = useSuspenseQuery(
    channelsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const channels = channelsData.items;

  if (channels.length === 0) {
    return <ChartEmptyState message="No channels available yet" />;
  }

  // eslint-disable-next-line eslint-js/no-restricted-syntax -- items.length > 0 guaranteed by guard above
  const fallback = channels[0]?.name ?? "";
  const effectiveSelected =
    channel && channels.some((ch) => ch.name === channel) ? channel : fallback;

  return (
    <div className="flex flex-col gap-3">
      <div className="w-48">
        <ServerSearchCombobox
          value={effectiveSelected}
          onValueChange={onChannelChange}
          options={list.items.map((item) => ({ value: item.name, label: item.name }))}
          search={list.search}
          onSearchChange={list.handleSearchChange}
          isPending={list.isPending}
          defaultListTruncated={list.defaultListTruncated}
          placeholder="Select channel"
          searchPlaceholder="Search channels…"
          emptyMessage="No channels found."
          ariaLabel="Channel"
        />
      </div>
      <Suspense fallback={chartSkeleton}>
        <ChannelHealthInner
          orgId={orgId}
          projectId={projectId}
          channel={effectiveSelected}
          period={period}
        />
      </Suspense>
    </div>
  );
};

const UpdateTrafficInner = ({
  orgId,
  projectId,
  updateId,
  period,
}: {
  orgId: string;
  projectId: string;
  updateId: string;
  period: AnalyticsPeriod;
}) => {
  const { data } = useSuspenseQuery(
    updateAnalyticsQueryOptions(orgId, projectId, updateId, period),
  );
  const isDarkMode = useIsDarkMode();

  if (data.unavailable) {
    return <ChartUnavailableState />;
  }

  if (data.totalRequests === 0) {
    return (
      <ChartEmptyState message="No requests for this update yet — data appears once devices download it." />
    );
  }

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      {/* Real timestamps on a time axis rather than pre-formatted labels, so
          the gaps between buckets are drawn to scale. */}
      <TimeseriesChart
        echarts={echarts}
        height={CHART_HEIGHT}
        isDarkMode={isDarkMode}
        gradient
        data={[
          {
            name: "Requests",
            color: ChartPalette.categorical(0, isDarkMode),
            data: data.timeSeries.map((entry): [number, number] => [
              new Date(entry.timestamp).getTime(),
              entry.requests,
            ]),
          },
        ]}
        xAxisTickCount={6}
        xAxisTickFormat={axisTimestampFormat}
        yAxisTickFormat={compactNumber}
        // The tooltip row is already labelled "Requests", so the value is just
        // the number.
        tooltipValueFormat={(value) => numberFormatter.format(value)}
      />
    </>
  );
};

export const UpdateTrafficChart = ({
  orgId,
  projectId,
  period,
  update,
  onUpdateChange,
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod;
  update: string | undefined;
  onUpdateChange: (next: string) => void;
}) => {
  const list = useServerSearchList((query) =>
    updatesQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );
  // Same cache key as the hook's default query, so this suspends without an
  // extra fetch; fallback + empty state stay pinned to the default list.
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const { items } = updatesData;

  if (items.length === 0) {
    return <ChartEmptyState message="No updates available yet" />;
  }

  // eslint-disable-next-line eslint-js/no-restricted-syntax -- items.length > 0 guaranteed by guard above
  const fallback = items[0]?.id ?? "";
  const effectiveUpdateId = update && items.some((upd) => upd.id === update) ? update : fallback;

  return (
    <div className="flex flex-col gap-3">
      <div className="w-48">
        <ServerSearchCombobox
          value={effectiveUpdateId}
          onValueChange={onUpdateChange}
          options={list.items.map((updateItem) => ({
            value: updateItem.id,
            label: updateLabel(updateItem),
          }))}
          search={list.search}
          onSearchChange={list.handleSearchChange}
          isPending={list.isPending}
          defaultListTruncated={list.defaultListTruncated}
          placeholder="Select update"
          searchPlaceholder="Search updates…"
          emptyMessage="No updates found."
          ariaLabel="Update"
        />
      </div>
      <Suspense fallback={chartSkeleton}>
        <UpdateTrafficInner
          orgId={orgId}
          projectId={projectId}
          updateId={effectiveUpdateId}
          period={period}
        />
      </Suspense>
    </div>
  );
};
