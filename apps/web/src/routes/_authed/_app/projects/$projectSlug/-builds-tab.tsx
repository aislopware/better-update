import {
  buildCompatibilityMatrixQueryOptions,
  buildsInfiniteQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { BuildCard } from "./-build-card";
import { DISTRIBUTION_LABELS } from "./-build-helpers";
import { synthesizeBuildChannels } from "./-compatibility-join";
import { CompatibilityMatrix } from "./-compatibility-matrix";

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

const DISTRIBUTION_FILTER_LABELS: Record<string, string> = {
  all: "All distributions",
  ...DISTRIBUTION_LABELS,
};

const BuildsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <PackageIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No builds yet</EmptyTitle>
      <EmptyDescription>Upload your first build using the CLI to get started.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const BuildsTab = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  const [platformFilter, setPlatformFilter] = useState<"ios" | "android" | undefined>(undefined);
  const [distributionFilter, setDistributionFilter] = useState<string | undefined>(undefined);

  const { data: matrix } = useSuspenseQuery(buildCompatibilityMatrixQueryOptions(orgId, projectId));
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    buildsInfiniteQueryOptions(
      orgId,
      projectId,
      platformFilter ? { platform: platformFilter } : {},
    ),
  );

  const allBuilds = useMemo(() => data.pages.flatMap((page) => page.items), [data.pages]);
  const visibleBuilds = useMemo(
    () =>
      distributionFilter === undefined
        ? allBuilds
        : allBuilds.filter((build) => build.distribution === distributionFilter),
    [allBuilds, distributionFilter],
  );

  const synthesizedBuilds = useMemo(
    () => visibleBuilds.map((build) => synthesizeBuildChannels(build, matrix)),
    [visibleBuilds, matrix],
  );

  return (
    <div className="flex flex-col gap-4">
      <CompatibilityMatrix
        builds={visibleBuilds}
        matrix={matrix}
        missingRuntimeVersions={matrix.missingRuntimeVersions}
      />
      <div className="flex justify-end gap-2">
        <Select
          items={PLATFORM_FILTER_LABELS}
          value={platformFilter ?? "all"}
          onValueChange={(value) => {
            if (value === "ios" || value === "android") {
              setPlatformFilter(value);
            } else {
              setPlatformFilter(undefined);
            }
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="ios">iOS</SelectItem>
              <SelectItem value="android">Android</SelectItem>
            </SelectGroup>
          </SelectPopup>
        </Select>
        <Select
          items={DISTRIBUTION_FILTER_LABELS}
          value={distributionFilter ?? "all"}
          onValueChange={(value) => {
            if (value) {
              setDistributionFilter(value === "all" ? undefined : value);
            }
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All distributions" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              <SelectItem value="all">All distributions</SelectItem>
              {Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      </div>
      {allBuilds.length === 0 && <BuildsEmptyState />}
      {allBuilds.length > 0 && synthesizedBuilds.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No builds match the selected filters.
        </p>
      )}
      {synthesizedBuilds.length > 0 && (
        <div className="flex flex-col gap-3">
          {synthesizedBuilds.map((build) => (
            <BuildCard
              key={build.id}
              build={build}
              orgId={orgId}
              projectId={projectId}
              projectSlug={projectSlug}
            />
          ))}
        </div>
      )}
      {hasNextPage && (
        <div className="flex items-center justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={async () => {
              await fetchNextPage();
            }}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
};
