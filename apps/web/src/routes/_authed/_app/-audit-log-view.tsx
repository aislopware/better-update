import { auditLogsInfiniteQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { DateRangePicker } from "@better-update/ui/components/date-range-picker";
import { Empty } from "@better-update/ui/components/empty";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { ScrollIcon } from "@phosphor-icons/react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";

import type { DateRange } from "react-day-picker";

import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  ListPanel,
  ListPanelFooter,
  optionalStringParam,
  PRIMARY_COLUMN_CLASS,
} from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import { isResourceType, RESOURCE_FILTER_OPTIONS, RESOURCE_TYPE_VALUES } from "./-audit-log-labels";
import { AuditLogRow } from "./-audit-log-row";

export const AuditLogSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <FilterBarSkeleton selectCount={2} />
    <TableSkeleton columns={5} rows={6} hasFooter={false} />
  </div>
);

export const auditLogSearchSchema = z.object({
  resourceType: enumArrayParam(RESOURCE_TYPE_VALUES),
  from: optionalStringParam(),
  to: optionalStringParam(),
});

export type AuditLogSearch = z.infer<typeof auditLogSearchSchema>;

const parseDateRange = (search: AuditLogSearch): DateRange | undefined => {
  if (!search.from || !search.to) {
    return undefined;
  }
  return { from: new Date(search.from), to: new Date(search.to) };
};

const EmptyState = ({ scopeLabel }: { scopeLabel: string }) => (
  <Empty
    icon={<ScrollIcon className="text-kumo-inactive size-10" />}
    title="No activity yet"
    description={`Actions performed in ${scopeLabel} will appear here.`}
  />
);

export interface AuditLogViewProps {
  readonly orgId: string;
  readonly projectId?: string;
  /**
   * Present only on a project's log, where every row belongs to one project and
   * a resource id is enough to build a path. The organization log spans projects
   * and an entry records no slug, so its rows stay unlinked.
   */
  readonly projectSlug?: string;
  readonly scopeLabel: string;
  readonly search: AuditLogSearch;
  readonly onChangeSearch: (next: AuditLogSearch) => void;
}

export const AuditLogView = ({
  orgId,
  projectId,
  projectSlug,
  scopeLabel,
  search,
  onChangeSearch,
}: AuditLogViewProps) => {
  const { resourceType, from, to } = search;
  const dateRange = parseDateRange(search);

  const filters = {
    ...(projectId ? { projectId } : {}),
    ...(resourceType.length > 0 ? { resourceType } : {}),
    ...(from && to ? { from, to } : {}),
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    auditLogsInfiniteQueryOptions(orgId, filters),
  );

  const items = data.pages.flatMap((page) => page.items);

  const handleResourceTypeChange = (next: readonly string[]): void => {
    onChangeSearch({ ...search, resourceType: next.filter(isResourceType) });
  };

  const handleDateRangeChange = (range: DateRange | undefined): void => {
    onChangeSearch({
      ...search,
      ...(range?.from ? { from: range.from.toISOString() } : { from: undefined }),
      ...(range?.to ? { to: range.to.toISOString() } : { to: undefined }),
    });
  };

  const isFiltered = resourceType.length > 0 || Boolean(from) || Boolean(to);

  const handleReset = (): void => {
    onChangeSearch({ resourceType: [], from: undefined, to: undefined });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <DataTableToolbar isFiltered={isFiltered} onReset={handleReset}>
        <DataTableFacetedFilter
          title="Resource"
          options={RESOURCE_FILTER_OPTIONS}
          selected={resourceType}
          onChange={handleResourceTypeChange}
        />
        <DateRangePicker
          value={dateRange}
          onChange={handleDateRangeChange}
          placeholder="Date range"
          triggerVariant="filter"
        />
      </DataTableToolbar>

      {items.length === 0 ? (
        <EmptyState scopeLabel={scopeLabel} />
      ) : (
        <ListPanel>
          {/* Headers never wrap, the same rule the shared list view follows: the
              primary column has already taken the width the others would use. */}
          <Table className="[&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead className={PRIMARY_COLUMN_CLASS}>Resource</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="text-right">When</TableHead>
                <TableHead className="w-16 pe-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <AuditLogRow key={entry.id} entry={entry} projectSlug={projectSlug} />
              ))}
            </TableBody>
          </Table>
          {/* The closing bar is always there, like every other list: an infinite
              log still owes the reader a count of what it has loaded so far. */}
          <ListPanelFooter>
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-kumo-subtle text-xs tabular-nums">
                {hasNextPage ? "First " : ""}
                {items.length} {pluralize(items.length, "event")}
              </span>
              {hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await fetchNextPage();
                  }}
                  loading={isFetchingNextPage}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </ListPanelFooter>
        </ListPanel>
      )}
    </div>
  );
};
