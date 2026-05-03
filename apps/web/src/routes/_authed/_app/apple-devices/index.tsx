import { getApiError } from "@better-update/api-client";
import {
  appleTeamsQueryOptions,
  devicesQueryKey,
  devicesQueryOptions,
  updateDevice,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { CardFrame, CardFrameFooter } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Input } from "@better-update/ui/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  CheckIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  SearchIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { DeviceClassValue, DeviceItem } from "@better-update/api-client/react";
import type {
  ColumnDef,
  FilterFn,
  SortingState,
  Table as TableInstance,
} from "@tanstack/react-table";

import { formatAppleTeamLabel } from "../-credentials-utils";
import { PageHeader } from "../../../../components/page-header";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { pluralize } from "../../../../lib/pluralize";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { InviteDeviceDialog } from "./-invite-dialog";
import { PendingInvitesList } from "./-pending-invites-list";
import { RegisterDeviceDialog } from "./-register-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const CLASS_FILTER_OPTIONS: { value: "ALL" | DeviceClassValue; label: string }[] = [
  { value: "ALL", label: "All classes" },
  { value: "IPHONE", label: "iPhone" },
  { value: "IPAD", label: "iPad" },
  { value: "MAC", label: "Mac" },
  { value: "UNKNOWN", label: "Unknown" },
];

const CLASS_LABEL: Record<DeviceClassValue, string> = {
  IPHONE: "iPhone",
  IPAD: "iPad",
  MAC: "Mac",
  UNKNOWN: "Unknown",
};

const nameIdentifierFilter: FilterFn<DeviceItem> = (row, _columnId, rawValue) => {
  const query = String(rawValue).trim().toLowerCase();
  if (!query) {
    return true;
  }
  return (
    row.original.name.toLowerCase().includes(query) ||
    row.original.identifier.toLowerCase().includes(query)
  );
};

const IdentifierCell = ({ identifier }: { identifier: string }) => {
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = async () => {
    const ok = await copy(identifier);
    if (ok) {
      toastManager.add({ title: "UDID copied", type: "success" });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <code className="bg-muted max-w-[22ch] truncate rounded px-1.5 py-0.5 font-mono text-xs">
        {identifier}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy UDID"
        onClick={async () => {
          await handleCopy();
        }}
      >
        {copied ? (
          <CheckIcon strokeWidth={2} className="size-3.5" />
        ) : (
          <CopyIcon strokeWidth={2} className="size-3.5" />
        )}
      </Button>
    </div>
  );
};

const actionsTrigger = (
  <Button variant="ghost" size="icon" aria-label="Device actions">
    <EllipsisVerticalIcon strokeWidth={2} />
  </Button>
);

const RowActions = ({ orgId, device }: { orgId: string; device: DeviceItem }) => {
  const queryClient = useQueryClient();
  const toggleEnabled = useMutation({
    mutationFn: async () => updateDevice(device.id, { enabled: !device.enabled }),
    onSuccess: async () => {
      toastManager.add({
        title: device.enabled ? "Device disabled" : "Device enabled",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
    },
    onError: (error) => {
      toastManager.add({ title: getApiError(error), type: "error" });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={actionsTrigger} />
      <DropdownMenuPopup align="end" className="w-40">
        <RenameDeviceDialog orgId={orgId} device={device}>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Rename
          </DropdownMenuItem>
        </RenameDeviceDialog>
        <DropdownMenuItem
          onSelect={() => {
            toggleEnabled.mutate();
          }}
          disabled={toggleEnabled.isPending}
        >
          {device.enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DeleteDeviceDialog orgId={orgId} device={device}>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Delete
          </DropdownMenuItem>
        </DeleteDeviceDialog>
      </DropdownMenuPopup>
    </DropdownMenu>
  );
};

const buildColumns = (
  orgId: string,
  teamLabels: Record<string, string>,
): ColumnDef<DeviceItem>[] => [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        {row.original.enabled ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        )}
        {row.original.name}
      </div>
    ),
  },
  {
    accessorKey: "identifier",
    header: "UDID",
    cell: ({ row }) => <IdentifierCell identifier={row.original.identifier} />,
    enableSorting: false,
  },
  {
    accessorKey: "deviceClass",
    header: "Class",
    cell: ({ row }) => <Badge variant="secondary">{CLASS_LABEL[row.original.deviceClass]}</Badge>,
  },
  {
    accessorKey: "appleTeamId",
    header: "Team",
    cell: ({ row }) => {
      const teamId = row.original.appleTeamId;
      if (teamId === null) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      return (
        <Badge variant="outline" className="font-mono text-xs">
          {teamLabels[teamId] ?? teamId.slice(0, 8)}
        </Badge>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.model ?? "—"}</span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "createdAt",
    header: "Added",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {formatRelativeTime(row.original.createdAt)}
      </span>
    ),
    sortingFn: "datetime",
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions orgId={orgId} device={row.original} />,
    enableSorting: false,
  },
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

const DevicesTable = ({
  table,
  columnCount,
  countLabel,
}: {
  table: TableInstance<DeviceItem>;
  columnCount: number;
  countLabel: string;
}) => {
  const { rows } = table.getRowModel();
  return (
    <CardFrame>
      <Table variant="card">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="text-muted-foreground h-24 text-center">
                No devices match your filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <CardFrameFooter className="text-muted-foreground justify-end text-sm">
        {countLabel}
      </CardFrameFooter>
    </CardFrame>
  );
};

const Devices = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [classFilter, setClassFilter] = useState<"ALL" | DeviceClassValue>("ALL");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");

  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamLabels = useMemo(() => {
    const result: Record<string, string> = {};
    teams.items.forEach((team) => {
      result[team.id] = formatAppleTeamLabel(team);
    });
    return result;
  }, [teams.items]);

  const { data } = useSuspenseQuery(
    devicesQueryOptions(orgId, {
      limit: 1000,
      ...(classFilter === "ALL" ? {} : { deviceClass: classFilter }),
      ...(teamFilter === "ALL" ? {} : { appleTeamId: teamFilter }),
    }),
  );

  const columns = useMemo(() => buildColumns(orgId, teamLabels), [orgId, teamLabels]);
  const tableData = useMemo<DeviceItem[]>(() => [...data.items], [data.items]);

  const table = useReactTable<DeviceItem>({
    data: tableData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    autoResetPageIndex: false,
    globalFilterFn: nameIdentifierFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const totalCount = data.total;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const registerCta = useMemo(() => <RegisterDeviceDialog orgId={orgId} />, [orgId]);
  const inviteCta = useMemo(() => <InviteDeviceDialog orgId={orgId} />, [orgId]);

  const headerActions = (
    <>
      {inviteCta}
      {registerCta}
    </>
  );

  if (totalCount === 0 && classFilter === "ALL" && globalFilter === "") {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Apple devices"
          description="Register UDIDs or invite team members to enroll their devices for ad-hoc builds."
          actions={headerActions}
        />
        <PendingInvitesList orgId={orgId} />
        <EmptyState orgId={orgId} inviteCta={inviteCta} />
      </div>
    );
  }

  const countLabel =
    filteredCount === data.items.length
      ? `${totalCount} ${pluralize(totalCount, "device")}`
      : `${filteredCount} of ${data.items.length} loaded`;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Apple devices"
        description="Register UDIDs or invite team members to enroll their devices for ad-hoc builds."
        actions={headerActions}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search devices…"
              value={globalFilter}
              onChange={(event) => {
                setGlobalFilter(event.target.value);
              }}
              className="pl-8"
            />
          </div>
          <Select
            value={classFilter}
            onValueChange={(next) => {
              if (next === null) {
                return;
              }
              setClassFilter(next);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {CLASS_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
          <Select
            value={teamFilter}
            onValueChange={(next) => {
              if (next === null) {
                return;
              }
              setTeamFilter(next);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All teams" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                <SelectItem value="ALL">All teams</SelectItem>
                {teams.items.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {formatAppleTeamLabel(team)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
        <PendingInvitesList orgId={orgId} />
        <DevicesTable table={table} columnCount={columns.length} countLabel={countLabel} />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/apple-devices/")({
  component: Devices,
});
