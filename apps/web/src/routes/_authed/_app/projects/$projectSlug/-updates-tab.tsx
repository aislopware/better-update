import {
  branchesQueryOptions,
  channelsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CloudUploadIcon } from "lucide-react";
import { useState } from "react";

import { UpdateCard } from "./-update-card";

const UpdatesEmptyState = () => (
  <Empty className="border">
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
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, branchFilter),
  );
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));
  const { data: channelsData } = useSuspenseQuery(channelsQueryOptions(orgId, projectId, 1000));
  const branchNames = new Map(branchesData.items.map((branch) => [branch.id, branch.name]));
  const branchFilterLabels: Record<string, string> = {
    all: "All branches",
    ...Object.fromEntries(branchesData.items.map((branch) => [branch.id, branch.name])),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
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
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All branches</SelectItem>
              {branchesData.items.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {updatesData.items.length === 0 ? (
        <UpdatesEmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {updatesData.items.map((update) => (
            <UpdateCard
              key={update.id}
              update={update}
              channels={channelsData.items}
              branchName={branchNames.get(update.branchId)}
              slug={slug}
              orgId={orgId}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
};
