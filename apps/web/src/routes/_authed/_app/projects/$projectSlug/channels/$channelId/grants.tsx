import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { LockIcon, PlusIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { z } from "zod";

import { SectionHeader } from "../../../../../../../components/page-header";
import { TableSkeleton } from "../../../../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../../../../lib/data-table";
import { pluralize } from "../../../../../../../lib/pluralize";
import { channelGrantsQueryOptions, membersQueryOptions } from "../../../../../../../queries/org";
import { GrantFormDialog } from "./-grant-form-dialog";
import { GrantsTableView } from "./-grants-table";

const SORT_COLUMNS = ["member", "effect"] as const;
const DEFAULT_SORT = "member" as const;

const grantsSearchSchema = z.object({
  sort: sortParam(DEFAULT_SORT),
});

const GrantsSkeleton = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <Skeleton className="h-5 w-24 rounded" />
      <Skeleton className="h-9 w-32 rounded-md" />
    </div>
    <TableSkeleton columns={4} rows={4} hasFooter={false} />
  </div>
);

const GrantsContent = () => {
  const { channelId } = Route.useParams();
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

  const { data: grants } = useSuspenseQuery(channelGrantsQueryOptions(channelId));
  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));

  const [addOpen, setAddOpen] = useState(false);
  const [addResetKey, setAddResetKey] = useState(0);

  const countLabel = `${grants.length} ${pluralize(grants.length, "grant")}`;

  const addButton = (
    <Button
      size="sm"
      onClick={() => {
        setAddOpen(true);
      }}
    >
      <PlusIcon strokeWidth={2} data-icon="inline-start" />
      Add grant
    </Button>
  );

  return (
    <>
      <SectionHeader
        title="Channel grants"
        description="Allow or deny specific actions for members on this channel."
        actions={grants.length > 0 ? addButton : undefined}
      />

      {grants.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No grants configured</EmptyTitle>
            <EmptyDescription>
              Add allow or deny grants to control per-member access on this channel.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton}</EmptyContent>
        </Empty>
      ) : (
        <GrantsTableView
          channelId={channelId}
          grants={grants}
          members={members}
          countLabel={countLabel}
          sorting={sorting}
          onSortingChange={onSortingChange}
        />
      )}

      <GrantFormDialog
        channelId={channelId}
        members={members}
        open={addOpen}
        onOpenChange={setAddOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setAddResetKey((prev) => prev + 1);
          }
        }}
        resetKey={addResetKey}
      />
    </>
  );
};

const GrantsPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<GrantsSkeleton />}>
      <GrantsContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/channels/$channelId/grants",
)({
  validateSearch: zodValidator(grantsSearchSchema),
  component: GrantsPage,
});
