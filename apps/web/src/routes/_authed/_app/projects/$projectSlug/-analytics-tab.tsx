import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
import { Select } from "@better-update/ui/components/select";
import { Suspense } from "react";
import { z } from "zod";

import { enumParam, optionalStringParam } from "../../../../../lib/data-table";
import { onPicked } from "../../../../../lib/form-utils";
import {
  AdoptionChart,
  ChannelHealthChart,
  PERIOD_LABELS,
  PERIODS,
  PlatformChart,
  UpdateTrafficChart,
  chartSkeleton,
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

export const AnalyticsTab = ({ orgId, projectId, search, onSearchChange }: AnalyticsTabProps) => {
  const { period, channel, update } = search;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select
          aria-label="Reporting period"
          className="w-40"
          items={PERIOD_LABELS}
          value={period}
          onValueChange={onPicked((next: AnalyticsSearch["period"]) => {
            onSearchChange({ period: next });
          })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  );
};
