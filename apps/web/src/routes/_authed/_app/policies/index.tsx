import { policiesQueryOptions } from "@better-update/api-client/react";
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
import { PlusIcon, ShieldIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { z } from "zod";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { sortParam, useDataTableSearch } from "../../../../lib/data-table";
import { pluralize } from "../../../../lib/pluralize";
import { PoliciesTableView } from "./-policies-table";
import { PolicyFormDialog } from "./-policy-form-dialog";

const SORT_COLUMNS = ["name", "createdAt"] as const;
const DEFAULT_SORT = "name" as const;

const policiesSearchSchema = z.object({
  sort: sortParam(DEFAULT_SORT),
});

const CreatePolicyButton = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Create policy
      </Button>
      <PolicyFormDialog orgId={orgId} open={open} onOpenChange={setOpen} />
    </>
  );
};

const PoliciesContent = () => {
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

  const { data } = useSuspenseQuery(policiesQueryOptions(orgId));
  const policies = data.items;
  const countLabel = `${policies.length} ${pluralize(policies.length, "policy", "policies")}`;

  if (policies.length === 0) {
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No policies yet</EmptyTitle>
            <EmptyDescription>
              Create a policy to grant scoped permissions, then attach it to members, groups, or API
              keys.
            </EmptyDescription>
          </EmptyHeader>
          <CreatePolicyButton orgId={orgId} />
        </Empty>
      </Card>
    );
  }

  return (
    <PoliciesTableView
      orgId={orgId}
      policies={policies}
      countLabel={countLabel}
      sorting={sorting}
      onSortingChange={onSortingChange}
    />
  );
};

const PoliciesPage = () => {
  const { activeOrg } = Route.useRouteContext();
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Policies"
        description="Reusable permission documents. Attach them to members, groups, or API keys to grant scoped access."
        actions={<CreatePolicyButton orgId={activeOrg.id} />}
      />
      <Suspense fallback={<TableSkeleton columns={4} rows={5} hasFooter={false} />}>
        <PoliciesContent />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/policies/")({
  validateSearch: zodValidator(policiesSearchSchema),
  component: PoliciesPage,
});
