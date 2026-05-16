import {
  adoptionQueryOptions,
  channelAnalyticsQueryOptions,
  channelsQueryOptions,
  platformAnalyticsQueryOptions,
  updateAnalyticsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";

import { enumParam, optionalStringParam } from "../../../../../lib/data-table";
import { formatChartTimestamp } from "../../../../../lib/format-date";
import { truncateId } from "../../../../../lib/truncate-id";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";

export const PERIODS = ["1d", "7d", "30d", "90d"] as const;

const PERIOD_LABELS: Record<string, string> = {
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};
export type AnalyticsPeriod = (typeof PERIODS)[number];

export const analyticsSearchSchema = z.object({
  period: enumParam(PERIODS, "7d"),
  channel: optionalStringParam(),
  update: optionalStringParam(),
});

export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>;

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

const chartSkeleton = <Skeleton className="h-[300px] w-full rounded-md" />;

const ChartEmptyState = ({ message }: { message: string }) => (
  <p className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
    {message}
  </p>
);

const ChartSummary = ({ requests, devices }: { requests: number; devices: number }) => (
  <p className="text-muted-foreground text-sm">
    {requests} requests &middot; {devices} unique devices
  </p>
);

const AdoptionChart = ({
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
    return <ChartEmptyState message="No analytics data available yet" />;
  }

  const chartData = data.updates.map((entry) => ({
    name: truncateId(entry.updateId),
    devices: entry.devices,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis type="category" dataKey="name" width={100} />
        <Tooltip />
        <Bar dataKey="devices" fill={COLORS[0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const PlatformChart = ({
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
    return <ChartEmptyState message="No analytics data available yet" />;
  }

  const chartData = data.platforms.map((entry, index) => ({
    name: entry.platform,
    value: entry.devices,
    fill: COLORS[index % COLORS.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label
        />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
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

  const chartData = [
    { name: "Manifest", value: data.responseTypeDistribution.manifest },
    { name: "Directive", value: data.responseTypeDistribution.directive },
    { name: "No Update", value: data.responseTypeDistribution.no_update },
  ];

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={80} />
          <Tooltip />
          <Bar dataKey="value" fill={COLORS[0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
};

const ChannelHealthChart = ({
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

  const channelLabels = Object.fromEntries(channels.map((item) => [item.name, item.name]));

  return (
    <div className="flex flex-col gap-3">
      <Select
        items={channelLabels}
        value={effectiveSelected}
        onValueChange={(value) => {
          if (value) {
            onChannelChange(value);
          }
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {channels.map((item) => (
              <SelectItem key={item.id} value={item.name}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
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

  const chartData = data.timeSeries.map((entry) => ({
    timestamp: formatChartTimestamp(entry.timestamp),
    requests: entry.requests,
  }));

  return (
    <>
      <ChartSummary requests={data.totalRequests} devices={data.uniqueDevices} />
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timestamp" />
          <YAxis />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="requests"
            stroke={COLORS[0]}
            fill={COLORS[0]}
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
};

const UpdateTrafficChart = ({
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

  const updateLabels = Object.fromEntries(
    items.map((updateItem) => [updateItem.id, truncateId(updateItem.id)]),
  );

  return (
    <div className="flex flex-col gap-3">
      <Select
        items={updateLabels}
        value={effectiveUpdateId}
        onValueChange={(value) => {
          if (value) {
            onUpdateChange(value);
          }
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {items.map((updateItem) => (
              <SelectItem key={updateItem.id} value={updateItem.id}>
                {truncateId(updateItem.id)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
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

export interface AnalyticsTabProps {
  readonly orgId: string;
  readonly projectId: string;
  readonly search: AnalyticsSearch;
  readonly onSearchChange: (next: Partial<AnalyticsSearch>) => void;
}

export const AnalyticsTab = ({ orgId, projectId, search, onSearchChange }: AnalyticsTabProps) => {
  const { period, channel, update } = search;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select
          items={PERIOD_LABELS}
          value={period}
          onValueChange={(value) => {
            const match = PERIODS.find((candidate) => candidate === value);
            if (match) {
              onSearchChange({ period: match });
            }
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              <SelectItem value="1d">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectGroup>
          </SelectPopup>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Update Adoption</CardTitle>
            <CardDescription>Devices per update</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={chartSkeleton}>
              <AdoptionChart orgId={orgId} projectId={projectId} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Split</CardTitle>
            <CardDescription>Device distribution by platform</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={chartSkeleton}>
              <PlatformChart orgId={orgId} projectId={projectId} period={period} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channel Health</CardTitle>
            <CardDescription>Request metrics per channel</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={chartSkeleton}>
              <ChannelHealthChart
                orgId={orgId}
                projectId={projectId}
                period={period}
                channel={channel}
                onChannelChange={(next) => {
                  onSearchChange({ channel: next });
                }}
              />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Update Traffic</CardTitle>
            <CardDescription>Hourly request volume per update</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={chartSkeleton}>
              <UpdateTrafficChart
                orgId={orgId}
                projectId={projectId}
                period={period}
                update={update}
                onUpdateChange={(next) => {
                  onSearchChange({ update: next });
                }}
              />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
