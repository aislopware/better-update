import { appleTeamsQueryOptions, devicesQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { SearchIcon, SearchXIcon, SmartphoneIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { DeviceClassValue, DeviceSortColumn } from "@better-update/api-client/react";
import type { ChangeEvent, ReactNode } from "react";

import { formatAppleTeamLabel, indexAppleTeamsById } from "../-credentials-utils";
import { PageHeader } from "../../../../components/page-header";
import { QueryErrorState } from "../../../../components/query-error-state";
import { FilterBarSkeleton, TableSkeleton } from "../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  optionalEnumParam,
  optionalStringParam,
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

const devicesSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
  deviceClass: optionalEnumParam(DEVICE_CLASSES),
  appleTeamId: optionalStringParam(),
});

const CLASS_FILTER_LABELS: Record<"ALL" | DeviceClassValue, string> = {
  ALL: "All classes",
  IPHONE: "iPhone",
  IPAD: "iPad",
  MAC: "Mac",
  UNKNOWN: "Unknown",
};

const CLASS_FILTER_VALUES: readonly ("ALL" | DeviceClassValue)[] = [
  "ALL",
  "IPHONE",
  "IPAD",
  "MAC",
  "UNKNOWN",
];

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

const DevicesFilterBar = ({
  search,
  isPlaceholderData,
  classFilter,
  teamFilter,
  teams,
  onSearchChange,
  onClassFilter,
  onTeamFilter,
}: {
  search: string;
  isPlaceholderData: boolean;
  classFilter: "ALL" | DeviceClassValue;
  teamFilter: string;
  teams: readonly { readonly id: string; readonly label: string }[];
  onSearchChange: (value: string) => void;
  onClassFilter: (value: "ALL" | DeviceClassValue) => void;
  onTeamFilter: (value: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <InputGroup className="min-w-[14rem] flex-1">
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search devices"
        placeholder="Search by name or UDID…"
        type="search"
        value={search}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onSearchChange(event.target.value);
        }}
      />
      {isPlaceholderData ? (
        <InputGroupAddon align="inline-end">
          <Spinner />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
    <Select
      items={CLASS_FILTER_LABELS}
      value={classFilter}
      onValueChange={(next) => {
        if (next === null) {
          return;
        }
        onClassFilter(next);
      }}
    >
      <SelectTrigger className="w-40">
        <SelectValue placeholder="All classes" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          {CLASS_FILTER_VALUES.map((value) => (
            <SelectItem key={value} value={value}>
              {CLASS_FILTER_LABELS[value]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
    <Select
      items={{
        ALL: "All teams",
        ...Object.fromEntries(teams.map((team) => [team.id, team.label])),
      }}
      value={teamFilter}
      onValueChange={(next) => {
        if (next === null) {
          return;
        }
        onTeamFilter(next);
      }}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All teams" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="ALL">All teams</SelectItem>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  </div>
);

const DevicesSkeleton = () => (
  <div className="flex flex-col gap-3">
    <FilterBarSkeleton hasSearch selectCount={2} />
    <TableSkeleton columns={5} rows={5} />
  </div>
);

const DevicesContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const routeNavigate = Route.useNavigate();
  const { page, sort, query: urlQuery, deviceClass, appleTeamId } = Route.useSearch();
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

  const handleClassFilter = (value: "ALL" | DeviceClassValue) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          deviceClass: value === "ALL" ? undefined : value,
          page: 1,
        }),
      }),
    );
  };

  const handleTeamFilter = (value: string) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          appleTeamId: value === "ALL" ? undefined : value,
          page: 1,
        }),
      }),
    );
  };

  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);
  const teamOptions = useMemo(
    () => teams.items.map((team) => ({ id: team.id, label: formatAppleTeamLabel(team) })),
    [teams.items],
  );

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...devicesQueryOptions(orgId, {
      page,
      limit: PAGE_SIZE,
      ...(deviceClass ? { deviceClass } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => buildDeviceColumns(orgId, teamsById), [orgId, teamsById]);
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

  const filtersActive = Boolean(deviceClass) || Boolean(appleTeamId) || urlQuery.length > 0;

  if (isLoading || data === undefined) {
    if (error) {
      return <QueryErrorState error={error} onRetry={refetch} />;
    }
    return <TableSkeleton columns={5} rows={5} />;
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
      <DevicesFilterBar
        search={searchDraft}
        isPlaceholderData={isPlaceholderData}
        classFilter={deviceClass ?? "ALL"}
        teamFilter={appleTeamId ?? "ALL"}
        teams={teamOptions}
        onSearchChange={handleSearchChange}
        onClassFilter={handleClassFilter}
        onTeamFilter={handleTeamFilter}
      />
      <PendingInvitesList orgId={orgId} />
      {data.total === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon strokeWidth={1.5} />
              </EmptyMedia>
              <EmptyTitle>No devices match your filters</EmptyTitle>
              <EmptyDescription>Adjust your filters or clear the search.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <DataTableView
          table={table}
          columnsCount={columns.length}
          isPlaceholderData={isPlaceholderData}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
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
  component: Devices,
});
