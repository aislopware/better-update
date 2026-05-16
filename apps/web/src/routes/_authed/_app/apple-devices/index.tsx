import { appleTeamsQueryOptions, devicesQueryOptions } from "@better-update/api-client/react";
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
import { SearchIcon, SearchXIcon, SmartphoneIcon } from "lucide-react";
import { Suspense, useMemo, useRef, useState } from "react";

import type {
  DeviceClassValue,
  DeviceSort,
  DeviceSortColumn,
} from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";
import type React from "react";

import { formatAppleTeamLabel } from "../-credentials-utils";
import { PageHeader } from "../../../../components/page-header";
import { FilterBarSkeleton, TableSkeleton } from "../../../../components/skeletons";
import { pluralize } from "../../../../lib/pluralize";
import { buildDeviceColumns } from "./-devices-columns";
import { DevicesTableView } from "./-devices-view";
import { InviteDeviceDialog } from "./-invite-dialog";
import { PendingInvitesList } from "./-pending-invites-list";
import { RegisterDeviceDialog } from "./-register-dialog";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMNS = [
  "name",
  "createdAt",
  "deviceClass",
] as const satisfies readonly DeviceSortColumn[];

const toApiSort = (sorting: SortingState): DeviceSort | undefined => {
  const [first] = sorting;
  if (!first) {
    return undefined;
  }
  const column = SORT_COLUMNS.find((col) => col === first.id);
  if (!column) {
    return undefined;
  }
  return first.desc ? `-${column}` : column;
};

const computePagination = (total: number, itemCount: number, page: number) => {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const fromIndex = itemCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIndex = (safePage - 1) * PAGE_SIZE + itemCount;
  return { totalPages, safePage, fromIndex, toIndex };
};

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

const EmptyState = ({ orgId, inviteCta }: { orgId: string; inviteCta: React.ReactNode }) => (
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
);

interface DevicesFiltersState {
  readonly classFilter: "ALL" | DeviceClassValue;
  readonly teamFilter: string;
  readonly debouncedQuery: string;
  readonly sorting: SortingState;
  readonly page: number;
}

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
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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

const useDevicesQuery = (orgId: string, filters: DevicesFiltersState) => {
  const apiSort = toApiSort(filters.sorting);
  return useQuery({
    ...devicesQueryOptions(orgId, {
      page: filters.page,
      limit: PAGE_SIZE,
      ...(filters.classFilter === "ALL" ? {} : { deviceClass: filters.classFilter }),
      ...(filters.teamFilter === "ALL" ? {} : { appleTeamId: filters.teamFilter }),
      ...(filters.debouncedQuery ? { query: filters.debouncedQuery } : {}),
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });
};

const DevicesSkeleton = () => (
  <div className="flex flex-col gap-3">
    <FilterBarSkeleton hasSearch selectCount={2} />
    <TableSkeleton columns={5} rows={5} />
  </div>
);

const DevicesContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<DevicesFiltersState>({
    classFilter: "ALL",
    teamFilter: "ALL",
    debouncedQuery: "",
    sorting: DEFAULT_SORTING,
    page: 1,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, debouncedQuery: value.trim(), page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev.sorting) : updater;
      return {
        ...prev,
        sorting: next.length === 0 ? DEFAULT_SORTING : next.slice(0, 1),
        page: 1,
      };
    });
  };

  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamLabels = useMemo(() => {
    const result: Record<string, string> = {};
    teams.items.forEach((team) => {
      result[team.id] = formatAppleTeamLabel(team);
    });
    return result;
  }, [teams.items]);
  const teamOptions = useMemo(
    () => teams.items.map((team) => ({ id: team.id, label: formatAppleTeamLabel(team) })),
    [teams.items],
  );

  const { data, isPlaceholderData, isLoading } = useDevicesQuery(orgId, filters);

  const columns = useMemo(() => buildDeviceColumns(orgId, teamLabels), [orgId, teamLabels]);
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting: filters.sorting },
    onSortingChange: handleSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const inviteCta = useMemo(() => <InviteDeviceDialog orgId={orgId} />, [orgId]);

  const filtersActive =
    filters.classFilter !== "ALL" ||
    filters.teamFilter !== "ALL" ||
    filters.debouncedQuery.length > 0;

  if (isLoading || data === undefined) {
    return <TableSkeleton columns={5} rows={5} />;
  }

  if (data.total === 0 && !filtersActive && search.length === 0) {
    return (
      <>
        <PendingInvitesList orgId={orgId} />
        <EmptyState orgId={orgId} inviteCta={inviteCta} />
      </>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    filters.page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "device")}${
    filtersActive ? " (filtered)" : ""
  }`;

  return (
    <div className="flex flex-col gap-3">
      <DevicesFilterBar
        search={search}
        isPlaceholderData={isPlaceholderData}
        classFilter={filters.classFilter}
        teamFilter={filters.teamFilter}
        teams={teamOptions}
        onSearchChange={handleSearchChange}
        onClassFilter={(classFilter) => {
          setFilters((prev) => ({ ...prev, classFilter, page: 1 }));
        }}
        onTeamFilter={(teamFilter) => {
          setFilters((prev) => ({ ...prev, teamFilter, page: 1 }));
        }}
      />
      <PendingInvitesList orgId={orgId} />
      {data.total === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No devices match your filters</EmptyTitle>
            <EmptyDescription>Adjust your filters or clear the search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DevicesTableView
          table={table}
          columnsCount={columns.length}
          isPlaceholderData={isPlaceholderData}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          onPageChange={(page) => {
            setFilters((prev) => ({ ...prev, page }));
          }}
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
  component: Devices,
});
