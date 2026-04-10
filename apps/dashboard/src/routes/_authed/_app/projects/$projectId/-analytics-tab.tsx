import {
  adoptionQueryOptions,
  platformAnalyticsQueryOptions,
} from "@better-update/api-client/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
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

const COLORS = ["#2563eb", "#16a34a", "#eab308", "#ef4444", "#8b5cf6", "#06b6d4"];

const truncateId = (id: string, maxLength = 8) =>
  id.length > maxLength ? `${id.slice(0, maxLength)}...` : id;

const AdoptionChart = ({ projectId }: { projectId: string }) => {
  const { data } = useSuspenseQuery(adoptionQueryOptions(projectId));

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

const PlatformChart = ({ projectId }: { projectId: string }) => {
  const { data } = useSuspenseQuery(platformAnalyticsQueryOptions(projectId));

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

export const AnalyticsTab = ({ projectId }: { orgId: string; projectId: string }) => (
  <div className="grid grid-cols-2 gap-4">
    <Card>
      <CardHeader>
        <CardTitle>Update Adoption</CardTitle>
        <CardDescription>Devices per update</CardDescription>
      </CardHeader>
      <CardContent>
        <AdoptionChart projectId={projectId} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Platform Split</CardTitle>
        <CardDescription>Device distribution by platform</CardDescription>
      </CardHeader>
      <CardContent>
        <PlatformChart projectId={projectId} />
      </CardContent>
    </Card>
  </div>
);
