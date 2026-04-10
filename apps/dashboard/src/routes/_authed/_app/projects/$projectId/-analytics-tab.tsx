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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
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

const PERIODS = ["1d", "7d", "30d", "90d"] as const;
type AnalyticsPeriod = (typeof PERIODS)[number];

const COLORS = ["#2563eb", "#16a34a", "#eab308", "#ef4444", "#8b5cf6", "#06b6d4"] as const;

const truncateId = (id: string, maxLength = 8) =>
  id.length > maxLength ? `${id.slice(0, maxLength)}...` : id;

const chartSkeleton = (
  <div className="flex h-[300px] items-center justify-center">
    <p className="text-muted-foreground text-sm">Loading...</p>
  </div>
);

const AdoptionChart = ({
  projectId,
  period,
}: {
  projectId: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data } = useSuspenseQuery(adoptionQueryOptions(projectId, period));

  if (data.updates.length === 0) {
    return (
      <p className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
        No analytics data available yet
      </p>
    );
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
  projectId,
  period,
}: {
  projectId: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data } = useSuspenseQuery(platformAnalyticsQueryOptions(projectId, period));

  if (data.platforms.length === 0) {
    return (
      <p className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
        No analytics data available yet
      </p>
    );
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
  projectId,
  channel,
  period,
}: {
  projectId: string;
  channel: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data } = useSuspenseQuery(channelAnalyticsQueryOptions(projectId, channel, period));

  const chartData = [
    { name: "Manifest", value: data.responseTypeDistribution.manifest },
    { name: "Directive", value: data.responseTypeDistribution.directive },
    { name: "No Update", value: data.responseTypeDistribution.no_update },
  ];

  return (
    <>
      <p className="text-muted-foreground text-sm">
        {data.totalRequests} requests &middot; {data.uniqueDevices} unique devices
      </p>
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
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data: channelsData } = useSuspenseQuery(channelsQueryOptions(orgId, projectId));
  const [selected, setSelected] = useState(channelsData.items[0]?.name ?? "");

  if (channelsData.items.length === 0) {
    return (
      <p className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
        No channels available yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={selected}
        onValueChange={(value) => {
          if (value) {
            setSelected(value);
          }
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {channelsData.items.map((channel) => (
            <SelectItem key={channel.id} value={channel.name}>
              {channel.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Suspense fallback={chartSkeleton}>
        <ChannelHealthInner projectId={projectId} channel={selected} period={period} />
      </Suspense>
    </div>
  );
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
};

const UpdateTrafficInner = ({
  projectId,
  updateId,
  period,
}: {
  projectId: string;
  updateId: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data } = useSuspenseQuery(updateAnalyticsQueryOptions(projectId, updateId, period));

  const chartData = data.timeSeries.map((entry) => ({
    timestamp: formatTimestamp(entry.timestamp),
    requests: entry.requests,
  }));

  return (
    <>
      <p className="text-muted-foreground text-sm">
        {data.totalRequests} requests &middot; {data.uniqueDevices} unique devices
      </p>
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
}: {
  orgId: string;
  projectId: string;
  period: AnalyticsPeriod | undefined;
}) => {
  const { data: updatesData } = useSuspenseQuery(updatesQueryOptions(orgId, projectId));
  const [selectedUpdateId, setSelectedUpdateId] = useState(updatesData.items[0]?.id ?? "");

  if (updatesData.items.length === 0) {
    return (
      <p className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
        No updates available yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={selectedUpdateId}
        onValueChange={(value) => {
          if (value) {
            setSelectedUpdateId(value);
          }
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {updatesData.items.map((update) => (
            <SelectItem key={update.id} value={update.id}>
              {truncateId(update.id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Suspense fallback={chartSkeleton}>
        <UpdateTrafficInner projectId={projectId} updateId={selectedUpdateId} period={period} />
      </Suspense>
    </div>
  );
};

export const AnalyticsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [period, setPeriod] = useState<AnalyticsPeriod>();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select
          value={period ?? "all"}
          onValueChange={(value) => {
            if (value) {
              setPeriod(
                value === "all" ? undefined : PERIODS.find((candidate) => candidate === value),
              );
            }
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="1d">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
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
              <AdoptionChart projectId={projectId} period={period} />
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
              <PlatformChart projectId={projectId} period={period} />
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
              <ChannelHealthChart orgId={orgId} projectId={projectId} period={period} />
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
              <UpdateTrafficChart orgId={orgId} projectId={projectId} period={period} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
