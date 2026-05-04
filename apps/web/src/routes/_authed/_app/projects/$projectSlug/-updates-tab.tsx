import {
  branchesInfiniteQueryOptions,
  channelsInfiniteQueryOptions,
  updatesInfiniteQueryOptions,
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
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { CloudUploadIcon } from "lucide-react";
import { useState } from "react";

import { UpdateCard } from "./-update-card";

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

const UpdatesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CloudUploadIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No updates yet</EmptyTitle>
      <EmptyDescription>Publish your first update using the CLI to see it here.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const UpdatesTab = ({
  orgId,
  projectId,
  slug,
}: {
  orgId: string;
  projectId: string;
  slug: string;
}) => {
  const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
  const [platformFilter, setPlatformFilter] = useState<"ios" | "android" | undefined>(undefined);

  const {
    data: updatesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSuspenseInfiniteQuery(
    updatesInfiniteQueryOptions(orgId, projectId, {
      ...(branchFilter ? { branchId: branchFilter } : {}),
      ...(platformFilter ? { platform: platformFilter } : {}),
    }),
  );
  const { data: branchesData } = useSuspenseInfiniteQuery(
    branchesInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const { data: channelsData } = useSuspenseInfiniteQuery(
    channelsInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const branches = branchesData.pages.flatMap((page) => page.items);
  const channels = channelsData.pages.flatMap((page) => page.items);

  const items = updatesData.pages.flatMap((page) => page.items);
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const branchFilterLabels: Record<string, string> = {
    all: "All branches",
    ...Object.fromEntries(branches.map((branch) => [branch.id, branch.name])),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
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
          items={branchFilterLabels}
          value={branchFilter ?? "all"}
          onValueChange={(value) => {
            if (value) {
              setBranchFilter(value === "all" ? undefined : value);
            }
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All branches" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      </div>
      {items.length === 0 ? (
        <UpdatesEmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((update) => (
            <UpdateCard
              key={update.id}
              update={update}
              channels={channels}
              branchName={branchNames.get(update.branchId)}
              slug={slug}
              orgId={orgId}
              projectId={projectId}
            />
          ))}
          {hasNextPage && (
            <div className="flex justify-center">
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
      )}
    </div>
  );
};
