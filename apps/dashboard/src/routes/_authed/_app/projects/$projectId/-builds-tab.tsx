import { buildCompatibilityMatrixQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";
import { useState } from "react";

import { BuildCard } from "./-build-card";
import { DISTRIBUTION_LABELS } from "./-build-helpers";
import { CompatibilityMatrix } from "./-compatibility-matrix";

const BuildsEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <PackageIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No builds yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Upload your first build using the CLI to get started.
      </p>
    </CardContent>
  </Card>
);

export const BuildsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [platformFilter, setPlatformFilter] = useState<"ios" | "android" | undefined>(undefined);
  const [distributionFilter, setDistributionFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const { data: compatibilityData } = useSuspenseQuery(
    buildCompatibilityMatrixQueryOptions(orgId, projectId),
  );

  const pageSize = 20;
  const filteredBuilds = compatibilityData.rows.filter(
    (build) =>
      (platformFilter === undefined || build.platform === platformFilter) &&
      (distributionFilter === undefined || build.distribution === distributionFilter),
  );
  const totalPages = Math.max(1, Math.ceil(filteredBuilds.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleBuilds = filteredBuilds.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="flex flex-col gap-4">
      <CompatibilityMatrix
        rows={visibleBuilds}
        missingRuntimeVersions={compatibilityData.missingRuntimeVersions}
      />
      <div className="flex justify-end gap-2">
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
      {compatibilityData.rows.length === 0 && <BuildsEmptyState />}
      {compatibilityData.rows.length > 0 && filteredBuilds.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No builds match the selected filters.
        </p>
      )}
      {visibleBuilds.length > 0 && (
        <div className="flex flex-col gap-3">
          {visibleBuilds.map((build) => (
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
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
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
