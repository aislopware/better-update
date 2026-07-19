import {
  adoptionQueryOptions,
  channelAnalyticsQueryOptions,
  channelsQueryOptions,
  platformAnalyticsQueryOptions,
  updateAnalyticsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@better-update/ui/components/ui/chart";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartConfig } from "@better-update/ui/components/ui/chart";

import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../../../components/server-search-combobox";
import { formatChartTimestamp } from "../../../../../lib/format-date";
import { truncateId } from "../../../../../lib/truncate-id";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";

export const PERIODS = ["1d", "7d", "30d", "90d"] as const;

export const PERIOD_LABELS: Record<string, string> = {
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export type AnalyticsPeriod = (typeof PERIODS)[number];

// Overview-row cards share one fixed chart height so the grid stays level.
const CHART_HEIGHT = "h-[180px]";

const ADOPTION_CHART_CONFIG = {
  devices: { label: "Devices", color: "var(--chart-1)" },
} satisfies ChartConfig;

// iOS ↔ chart-1 (blue) and Android ↔ chart-2 (green) — the same mapping every
// chart in the app uses; unexpected platforms fall back to the tail hues.
const PLATFORM_CHART_CONFIG = {
  ios: { label: "iOS", color: "var(--chart-1)" },
  android: { label: "Android", color: "var(--chart-2)" },
} satisfies ChartConfig;

const PLATFORM_FALLBACK_COLORS = ["var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

const platformFill = (platform: string, index: number): string =>
  platform in PLATFORM_CHART_CONFIG
    ? `var(--color-${platform})`
    : (PLATFORM_FALLBACK_COLORS[index % PLATFORM_FALLBACK_COLORS.length] ?? "var(--chart-5)");

const CHANNEL_HEALTH_CHART_CONFIG = {
  value: { label: "Requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

const TRAFFIC_CHART_CONFIG = {
  requests: { label: "Requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

export const chartSkeleton = <Skeleton className={`${CHART_HEIGHT} w-full rounded-md`} />;

// Prefer the human message over an opaque id in the update picker.
const updateLabel = (updateItem: { readonly id: string; readonly message: string }) =>
  updateItem.message || truncateId(updateItem.id);

const ChartEmptyState = ({ message }: { message: string }) => (
  <p className={`text-muted-foreground flex ${CHART_HEIGHT} items-center justify-center text-sm`}>
    {message}
  </p>
);

const ChartSummary = ({ requests, devices }: { requests: number; devices: number }) => (
  <p className="text-muted-foreground text-sm">
    {requests} requests &middot; {devices} unique devices
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

  if (data.updates.length === 0) {
    return (
      <ChartEmptyState message="No analytics yet — data appears once devices check for updates." />
    );
  }

  const chartData = data.updates.map((entry) => ({
    name: truncateId(entry.updateId),
    devices: entry.devices,
  }));

  return (
    <ChartContainer config={ADOPTION_CHART_CONFIG} className={`${CHART_HEIGHT} w-full`}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="devices" fill="var(--color-devices)" radius={4} />
      </BarChart>
    </ChartContainer>
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

  if (data.platforms.length === 0) {
    return (
      <ChartEmptyState message="No analytics yet — data appears once devices check for updates." />
    );
  }

  const chartData = data.platforms.map((entry, index) => ({
    name: entry.platform,
    value: entry.devices,
    fill: platformFill(entry.platform, index),
  }));

  return (
    <ChartContainer config={PLATFORM_CHART_CONFIG} className={`${CHART_HEIGHT} w-full`}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={36}
          outerRadius={58}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} />
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
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

  if (data.totalRequests === 0) {
    return (
      <ChartEmptyState message="No requests on this channel yet — data appears once devices check for updates." />
    );
  }

  const chartData = [
    { name: "Manifest", value: data.responseTypeDistribution.manifest },
    { name: "Directive", value: data.responseTypeDistribution.directive },
    { name: "No update", value: data.responseTypeDistribution.no_update },
  ];

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      <ChartContainer config={CHANNEL_HEALTH_CHART_CONFIG} className={`${CHART_HEIGHT} w-full`}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={80} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
      </ChartContainer>
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

  if (data.totalRequests === 0) {
    return (
      <ChartEmptyState message="No requests for this update yet — data appears once devices download it." />
    );
  }

  const chartData = data.timeSeries.map((entry) => ({
    timestamp: formatChartTimestamp(entry.timestamp),
    requests: entry.requests,
  }));

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      <ChartContainer config={TRAFFIC_CHART_CONFIG} className={`${CHART_HEIGHT} w-full`}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="timestamp" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="requests"
            stroke="var(--color-requests)"
            fill="var(--color-requests)"
            fillOpacity={0.25}
          />
        </AreaChart>
      </ChartContainer>
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
