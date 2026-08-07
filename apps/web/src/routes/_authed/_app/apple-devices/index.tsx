import { appleTeamsQueryOptions, devicesQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@better-update/ui/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { SmartphoneIcon, TriangleAlertIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { DeviceClassValue, DeviceSortColumn } from "@better-update/api-client/react";
import type { ReactNode } from "react";

import { formatAppleTeamLabel, indexAppleTeamsById } from "../-credentials-utils";
import { PageHeader } from "../../../../components/page-header";
import { QueryErrorState } from "../../../../components/query-error-state";
import { FilterBarSkeleton, TableSkeleton } from "../../../../components/skeletons";
import { assertCapability } from "../../../../lib/access";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  DataTableView,
  DataTableViewOptions,
  PAGE_SIZE,
  computePagination,
  enumArrayParam,
  fireAndForget,
  freeStringArrayParam,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../lib/data-table";
import { pluralize } from "../../../../lib/pluralize";
import { buildDeviceColumns } from "./-devices-columns";
import { InviteDeviceDialog } from "./-invite-dialog";
import { PendingInvitesList } from "./-pending-invites-list";
import { RegisterDeviceDialog } from "./-register-dialog";

const SEARCH_DEBOUNCE_MS = 300;

const SORT_COLUMNS = [
  "name",
  "createdAt",
  "deviceClass",
] as const satisfies readonly DeviceSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const DEVICE_CLASSES = ["IPHONE", "IPAD", "MAC", "UNKNOWN"] as const;

const SYNC_STATES = ["synced", "unsynced"] as const;

type SyncStateValue = (typeof SYNC_STATES)[number];

const devicesSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
  deviceClass: enumArrayParam(DEVICE_CLASSES),
  appleTeamId: freeStringArrayParam(),
  synced: enumArrayParam(SYNC_STATES),
});

// Faceted-filter options — an empty selection means "all classes" (deviceClass
// param unset), so there is no "ALL" pseudo-option.
const CLASS_FILTER_OPTIONS = [
  { value: "IPHONE", label: "iPhone" },
  { value: "IPAD", label: "iPad" },
  { value: "MAC", label: "Mac" },
  { value: "UNKNOWN", label: "Unknown" },
] as const;

// Both selected = both states = no filter, so there is no "ALL" pseudo-option
// here either; a single selection maps onto the API's boolean `synced` param.
const SYNC_FILTER_OPTIONS = [
  { value: "synced", label: "Synced" },
  { value: "unsynced", label: "Not synced" },
] as const;

const isDeviceClass = (value: unknown): value is DeviceClassValue =>
  (DEVICE_CLASSES as readonly unknown[]).includes(value);

const isSyncState = (value: unknown): value is SyncStateValue =>
  (SYNC_STATES as readonly unknown[]).includes(value);

// Low-value columns opted into hiding via DataTableViewOptions. Applied here
// (not in -devices-columns) so the shared column defs stay presentation-neutral.
const HIDEABLE_COLUMN_IDS = new Set(["appleSync", "model", "createdAt"]);

const EmptyState = ({ orgId, inviteCta }: { orgId: string; inviteCta: ReactNode }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SmartphoneIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No devices registered</EmptyTitle>
        <EmptyDescription>
          Register an Apple device UDID, or send an invite link for self-service enrollment via iOS
          Safari.
        </EmptyDescription>
      </EmptyHeader>
      <div className="flex items-center gap-2">
        <RegisterDeviceDialog orgId={orgId} />
        {inviteCta}
      </div>
    </Empty>
  </Card>
);

const DevicesSkeleton = () => (
  <div className="flex flex-col gap-3">
    <FilterBarSkeleton hasSearch selectCount={4} />
    <TableSkeleton columns={8} rows={5} />
  </div>
);

// Standing warning above the table when any visible device is missing its
// Apple portal registration: such devices are absent from ad-hoc provisioning
// profiles until a `devices sync` runs. Counted with a one-row probe query
// (only `total` matters) so the warning is independent of the table's current
// filters and pagination; team visibility scoping still applies server-side.
const UnsyncedDevicesBanner = ({ orgId }: { orgId: string }) => {
  const { data } = useQuery(devicesQueryOptions(orgId, { limit: 1, synced: false }));
  const count = data?.total ?? 0;
  if (count === 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>
        {count} {pluralize(count, "device")} not synced with Apple
      </AlertTitle>
      <AlertDescription>
        Devices without an Apple Developer portal registration are left out of ad-hoc provisioning
        profiles. Run{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          better-update devices sync
        </code>{" "}
        to register them.
      </AlertDescription>
    </Alert>
  );
};

const DevicesContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const routeNavigate = Route.useNavigate();
  const { page, sort, query: urlQuery, deviceClass, appleTeamId, synced } = Route.useSearch();
  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate: routeNavigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: urlQuery,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        routeNavigate({
          to: ".",
          search: (prev) => ({ ...prev, query: value, page: 1 }),
          replace: true,
        }),
      );
    },
  });

  // Single navigate helper for every filter mutation — patches the given search
  // params and returns to page 1.
  const applyFilters = (patch: {
    readonly query?: string;
    readonly deviceClass?: DeviceClassValue[];
    readonly appleTeamId?: string[];
    readonly synced?: SyncStateValue[];
  }): void => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, ...patch, page: 1 }),
      }),
    );
  };

  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);
  const teamOptions = useMemo(
    () => teams.items.map((team) => ({ value: team.id, label: formatAppleTeamLabel(team) })),
    [teams.items],
  );

  // Selecting both sync states filters nothing, so only a single selection
  // narrows the list (the API param is a boolean).
  const syncedFilter = synced.length === 1 ? synced[0] === "synced" : undefined;

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...devicesQueryOptions(orgId, {
      page,
      limit: PAGE_SIZE,
      ...(deviceClass.length > 0 ? { deviceClass } : {}),
      ...(appleTeamId.length > 0 ? { appleTeamId } : {}),
      ...(syncedFilter === undefined ? {} : { synced: syncedFilter }),
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  // buildDeviceColumns returns fresh column objects per call, so assigning the
  // hideable flag in place is safe (no shared defs are mutated).
  const columns = useMemo(
    () =>
      buildDeviceColumns(orgId, teamsById).map((column) =>
        column.id !== undefined && HIDEABLE_COLUMN_IDS.has(column.id)
          ? Object.assign(column, { enableHiding: true })
          : column,
      ),
    [orgId, teamsById],
  );
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const filtersActive =
    deviceClass.length > 0 || appleTeamId.length > 0 || synced.length > 0 || urlQuery.length > 0;

  if (isLoading || data === undefined) {
    if (error) {
      return <QueryErrorState error={error} onRetry={refetch} />;
    }
    return <TableSkeleton columns={8} rows={5} />;
  }

  if (data.total === 0 && !filtersActive && searchDraft.length === 0) {
    return (
      <>
        <PendingInvitesList orgId={orgId} />
        <EmptyState orgId={orgId} inviteCta={<InviteDeviceDialog orgId={orgId} />} />
      </>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "device")}${
    filtersActive ? " (filtered)" : ""
  }`;

  return (
    <div className="flex flex-col gap-3">
      <UnsyncedDevicesBanner orgId={orgId} />
      <DataTableToolbar
        search={{
          value: searchDraft,
          onChange: handleSearchChange,
          placeholder: "Search by name or UDID…",
        }}
        isFiltered={filtersActive}
        onReset={() => {
          handleSearchChange("");
          applyFilters({ query: "", deviceClass: [], appleTeamId: [], synced: [] });
        }}
        actions={<DataTableViewOptions table={table} />}
      >
        <DataTableFacetedFilter
          title="Class"
          options={CLASS_FILTER_OPTIONS}
          selected={deviceClass}
          onChange={(next) => {
            applyFilters({ deviceClass: next.filter(isDeviceClass) });
          }}
        />
        <DataTableFacetedFilter
          title="Team"
          options={teamOptions}
          selected={appleTeamId}
          onChange={(next) => {
            applyFilters({ appleTeamId: [...next] });
          }}
        />
        <DataTableFacetedFilter
          title="Apple sync"
          options={SYNC_FILTER_OPTIONS}
          selected={synced}
          onChange={(next) => {
            applyFilters({ synced: next.filter(isSyncState) });
          }}
        />
      </DataTableToolbar>
      <PendingInvitesList orgId={orgId} />
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        emptyMessage="No devices match your filters."
      />
    </div>
  );
};

const Devices = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const headerActions = (
    <>
      <InviteDeviceDialog orgId={orgId} />
      <RegisterDeviceDialog orgId={orgId} />
    </>
  );
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Apple devices"
        description="Register UDIDs or invite team members to enroll their devices for ad-hoc builds."
        actions={headerActions}
      />
      <Suspense fallback={<DevicesSkeleton />}>
        <DevicesContent />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/apple-devices/")({
  validateSearch: zodValidator(devicesSearchSchema),
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canViewDevices");
  },
  component: Devices,
});
