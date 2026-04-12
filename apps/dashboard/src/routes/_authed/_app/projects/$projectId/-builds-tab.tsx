import { buildsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Package02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { BuildCard } from "./-build-card";
import { DISTRIBUTION_LABELS } from "./-build-helpers";
import { UploadBuildDialog } from "./-upload-build-dialog";

const BuildsEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={Package02Icon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No builds yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Upload your first build artifact to get started.
      </p>
    </CardContent>
  </Card>
);

export const BuildsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [platformFilter, setPlatformFilter] = useState<"ios" | "android" | undefined>(undefined);
  const [distributionFilter, setDistributionFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const { data: buildsData } = useSuspenseQuery(
    buildsQueryOptions(
      orgId,
      projectId,
      platformFilter ? { platform: platformFilter } : undefined,
      page,
    ),
  );

  const totalPages = Math.ceil(buildsData.total / buildsData.limit);
  const filteredBuilds = distributionFilter
    ? buildsData.items.filter((build) => build.distribution === distributionFilter)
    : buildsData.items;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <UploadBuildDialog projectId={projectId} orgId={orgId} />
        <Select
          value={platformFilter ?? "all"}
          onValueChange={(value) => {
            if (value === "ios" || value === "android") {
              setPlatformFilter(value);
            } else {
              setPlatformFilter(undefined);
            }
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="ios">iOS</SelectItem>
            <SelectItem value="android">Android</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={distributionFilter ?? "all"}
          onValueChange={(value) => {
            if (value) {
              setDistributionFilter(value === "all" ? undefined : value);
            }
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All distributions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All distributions</SelectItem>
            {Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {buildsData.items.length === 0 && <BuildsEmptyState />}
      {buildsData.items.length > 0 && filteredBuilds.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No builds match the selected filters.
        </p>
      )}
      {filteredBuilds.length > 0 && (
        <div className="flex flex-col gap-3">
          {filteredBuilds.map((build) => (
            <BuildCard key={build.id} build={build} orgId={orgId} projectId={projectId} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage((prev) => prev - 1);
            }}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {buildsData.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * buildsData.limit >= buildsData.total}
            onClick={() => {
              setPage((prev) => prev + 1);
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};
