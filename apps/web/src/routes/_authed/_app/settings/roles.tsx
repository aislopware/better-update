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
import { PlusIcon, ShieldIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { z } from "zod";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../lib/data-table";
import { pluralize } from "../../../../lib/pluralize";
import { rolesQueryOptions } from "../../../../queries/org";
import { RoleFormDialog } from "./-role-form-dialog";
import { RolesTableView } from "./-roles-table";

const SORT_COLUMNS = ["name", "permissions"] as const;
const DEFAULT_SORT = "name" as const;

const rolesSearchSchema = z.object({
  sort: sortParam(DEFAULT_SORT),
});

const RolesSkeleton = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <Skeleton className="h-5 w-24 rounded" />
      <Skeleton className="h-9 w-32 rounded-md" />
    </div>
    <TableSkeleton columns={3} rows={4} hasFooter={false} />
  </div>
);

const RolesContent = () => {
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

  const { data: roles } = useSuspenseQuery(rolesQueryOptions(orgId));

  const [createOpen, setCreateOpen] = useState(false);
  const [createResetKey, setCreateResetKey] = useState(0);

  const countLabel = `${roles.length} custom ${pluralize(roles.length, "role")}`;

  const openCreate = () => {
    setCreateOpen(true);
  };

  const createButton = (
    <Button onClick={openCreate}>
      <PlusIcon strokeWidth={2} data-icon="inline-start" />
      Create role
    </Button>
  );

  return (
    <>
      {roles.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No custom roles yet</EmptyTitle>
            <EmptyDescription>
              Create custom roles to grant specific permissions to members.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{createButton}</EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">{countLabel}</span>
            {createButton}
          </div>
          <RolesTableView
            orgId={orgId}
            roles={roles}
            countLabel={countLabel}
            sorting={sorting}
            onSortingChange={onSortingChange}
          />
        </div>
      )}

      <RoleFormDialog
        orgId={orgId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setCreateResetKey((prev) => prev + 1);
          }
        }}
        resetKey={createResetKey}
      />
    </>
  );
};

const RolesPage = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Roles"
      description="Create and manage custom roles with fine-grained resource permissions."
    />
    <Suspense fallback={<RolesSkeleton />}>
      <RolesContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/roles")({
  validateSearch: zodValidator(rolesSearchSchema),
  component: RolesPage,
});
