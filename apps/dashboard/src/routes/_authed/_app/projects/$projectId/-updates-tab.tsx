import {
  branchesQueryOptions,
  channelsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CloudUploadIcon } from "lucide-react";
import { useState } from "react";

import { UpdateCard } from "./-update-card";

const UpdatesEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <CloudUploadIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No updates yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Publish your first update using the CLI to see it here.
      </p>
    </CardContent>
  </Card>
);

export const UpdatesTab = ({
  orgId,
  projectId,
  scopeKey,
}: {
  orgId: string;
  projectId: string;
  scopeKey: string;
}) => {
  const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, branchFilter),
  );
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));
  const { data: channelsData } = useSuspenseQuery(channelsQueryOptions(orgId, projectId, 1000));
  const branchNames = new Map(branchesData.items.map((branch) => [branch.id, branch.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select
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
            <SelectItem value="all">All branches</SelectItem>
            {branchesData.items.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
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
              scopeKey={scopeKey}
              orgId={orgId}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
};
