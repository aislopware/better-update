import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
import { Empty } from "@better-update/ui/components/empty";
import { Select } from "@better-update/ui/components/select";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { ChartLineUpIcon } from "@phosphor-icons/react";
import { Suspense } from "react";
import { z } from "zod";

import { enumParam, optionalStringParam } from "../../../../../lib/data-table";
import { onPicked } from "../../../../../lib/form-utils";
import {
  ANALYTICS_UNAVAILABLE_MESSAGE,
  AdoptionChart,
  ChannelHealthChart,
  DeliveryChart,
  PERIOD_LABELS,
  PERIODS,
  PlatformChart,
  UpdateTrafficChart,
  chartSkeleton,
  useAnalyticsStatus,
} from "./-analytics-charts";

export const analyticsSearchSchema = z.object({
  period: enumParam(PERIODS, "7d"),
  channel: optionalStringParam(),
  update: optionalStringParam(),
});

export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>;

export interface AnalyticsTabProps {
  readonly orgId: string;
  readonly projectId: string;
  readonly search: AnalyticsSearch;
  readonly onSearchChange: (next: Partial<AnalyticsSearch>) => void;
}

/**
 * Reporting-period control for the analytics section. Rendered by the page into
 * the section header's actions slot rather than on a line of its own: a control
 * that scopes a whole section belongs beside that section's name, not floating
 * in the gap above the first card.
 */
export const AnalyticsPeriodSelect = ({
  period,
  onPeriodChange,
}: {
  period: AnalyticsSearch["period"];
  onPeriodChange: (next: AnalyticsSearch["period"]) => void;
}) => (
  <Select
    aria-label="Reporting period"
    className="w-40"
    items={PERIOD_LABELS}
    value={period}
    onValueChange={onPicked(onPeriodChange)}
  />
);

const GRID_CLASS = "grid gap-4 sm:grid-cols-2";

const CHART_CARD_COUNT = 5;

const AnalyticsSkeleton = () => (
  <div className={GRID_CLASS}>
    {Array.from({ length: CHART_CARD_COUNT }, (_, index) => (
      <Skeleton key={index} className="skeleton-appear h-72 w-full rounded-lg" />
    ))}
  </div>
);

/**
 * One sentence for the whole section rather than four boxes each saying the
 * same thing: until a device checks in there is nothing to plot, and a project
 * that has never been published to is the common case for that.
 */
const AnalyticsEmpty = () => (
  <Empty
    // A section of the page, not the whole of it: the compact size keeps the
    // sentence from opening a screen of white under the lists above it.
    size="sm"
    icon={<ChartLineUpIcon className="text-kumo-inactive size-8" />}
    title="No analytics in this period"
    description="Adoption, platform split and request traffic appear here once devices running this project check in for updates."
  />
);

/**
 * Telemetry is down, not absent. Said once for the section, in the same place
 * the "nothing yet" sentence would go — reading zeros as no traffic when the
 * server never got an answer is the mistake this exists to prevent.
 */
const AnalyticsUnavailable = () => (
  <Empty
    size="sm"
    icon={<ChartLineUpIcon className="text-kumo-inactive size-8" />}
    title="Analytics unavailable"
    description={ANALYTICS_UNAVAILABLE_MESSAGE}
  />
);

const AnalyticsCharts = ({ orgId, projectId, search, onSearchChange }: AnalyticsTabProps) => {
  const { period, channel, update } = search;
  const status = useAnalyticsStatus(orgId, projectId, period);

  if (status === "unavailable") {
    return <AnalyticsUnavailable />;
  }

  if (status === "empty") {
    return <AnalyticsEmpty />;
  }

  return (
    <div className={GRID_CLASS}>
      <Card>
        <CardHeader>
          <CardTitle>Update adoption</CardTitle>
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
          <CardTitle>Platform split</CardTitle>
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
          <CardTitle>Channel health</CardTitle>
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
          <CardTitle>Bundle delivery</CardTitle>
          <CardDescription>What devices downloaded: patch vs full bundle</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={chartSkeleton}>
            <DeliveryChart orgId={orgId} projectId={projectId} period={period} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Update traffic</CardTitle>
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
  );
};

export const AnalyticsTab = ({ orgId, projectId, search, onSearchChange }: AnalyticsTabProps) => (
  // The section decides between four cards and one sentence before it can draw
  // either, so the wait belongs here rather than inside each card.
  <Suspense fallback={<AnalyticsSkeleton />}>
    <AnalyticsCharts
      orgId={orgId}
      projectId={projectId}
      search={search}
      onSearchChange={onSearchChange}
    />
  </Suspense>
);
