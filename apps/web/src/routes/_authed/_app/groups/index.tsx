import { groupsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { PlusIcon, UsersRoundIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { z } from "zod";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../lib/data-table";
import { pluralize } from "../../../../lib/pluralize";
import { GroupFormDialog } from "./-group-form-dialog";
import { GroupsTableView } from "./-groups-table";

const SORT_COLUMNS = ["name", "createdAt"] as const;
const DEFAULT_SORT = "name" as const;

const groupsSearchSchema = z.object({
  sort: sortParam(DEFAULT_SORT),
});

const CreateGroupButton = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Create group
      </Button>
      <GroupFormDialog orgId={orgId} open={open} onOpenChange={setOpen} />
    </>
  );
};

const GroupsContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { sort } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, onSortingChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const { data } = useSuspenseQuery(groupsQueryOptions(orgId));
  const groups = data.items;
  const countLabel = `${groups.length} ${pluralize(groups.length, "group")}`;

  if (groups.length === 0) {
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No groups yet</EmptyTitle>
            <EmptyDescription>
              Create a group to bundle members together, then attach policies to the group.
            </EmptyDescription>
          </EmptyHeader>
          <CreateGroupButton orgId={orgId} />
        </Empty>
      </Card>
    );
  }

  return (
    <GroupsTableView
      orgId={orgId}
      groups={groups}
      countLabel={countLabel}
      sorting={sorting}
      onSortingChange={onSortingChange}
    />
  );
};

const GroupsPage = () => {
  const { activeOrg } = Route.useRouteContext();
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Groups"
        description="Collect members into groups and attach policies once to grant everyone in the group the same access."
        actions={<CreateGroupButton orgId={activeOrg.id} />}
      />
      <Suspense fallback={<TableSkeleton columns={4} rows={5} hasFooter={false} />}>
        <GroupsContent />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/groups/")({
  validateSearch: zodValidator(groupsSearchSchema),
  component: GroupsPage,
});
