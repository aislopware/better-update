import { getApiError } from "@better-update/api-client";
import {
  appleTeamsQueryOptions,
  devicesInfiniteQueryOptions,
  devicesQueryKey,
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
import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  SearchIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { DeviceClassValue, DeviceItem } from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "../-credentials-utils";
import { PageHeader } from "../../../../components/page-header";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";
import { DeleteDeviceDialog } from "./-delete-device-dialog";
import { InviteDeviceDialog } from "./-invite-dialog";
import { PendingInvitesList } from "./-pending-invites-list";
import { RegisterDeviceDialog } from "./-register-dialog";
import { RenameDeviceDialog } from "./-rename-device-dialog";

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

const DeviceRow = ({
  device,
  orgId,
  teamLabels,
}: {
  device: DeviceItem;
  orgId: string;
  teamLabels: Record<string, string>;
}) => (
  <TableRow key={device.id}>
    <TableCell>
      <div className="flex items-center gap-2 font-medium">
        {device.enabled ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        )}
        {device.name}
      </div>
    </TableCell>
    <TableCell>
      <IdentifierCell identifier={device.identifier} />
    </TableCell>
    <TableCell>
      <Badge variant="secondary">{CLASS_LABEL[device.deviceClass]}</Badge>
    </TableCell>
    <TableCell>
      {device.appleTeamId === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        <Badge variant="outline" className="font-mono text-xs">
          {teamLabels[device.appleTeamId] ?? device.appleTeamId.slice(0, 8)}
        </Badge>
      )}
    </TableCell>
    <TableCell>
      <span className="text-muted-foreground text-sm">{device.model ?? "—"}</span>
    </TableCell>
    <TableCell>
      <span className="text-muted-foreground text-sm">{formatRelativeTime(device.createdAt)}</span>
    </TableCell>
    <TableCell>
      <RowActions orgId={orgId} device={device} />
    </TableCell>
  </TableRow>
);

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

const SEARCH_DEBOUNCE_MS = 300;

const Devices = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const [classFilter, setClassFilter] = useState<"ALL" | DeviceClassValue>("ALL");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  };

  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamLabels = useMemo(() => {
    const result: Record<string, string> = {};
    teams.items.forEach((team) => {
      result[team.id] = formatAppleTeamLabel(team);
    });
    return result;
  }, [teams.items]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    devicesInfiniteQueryOptions(orgId, {
      ...(classFilter === "ALL" ? {} : { deviceClass: classFilter }),
      ...(teamFilter === "ALL" ? {} : { appleTeamId: teamFilter }),
      ...(debouncedQuery ? { query: debouncedQuery } : {}),
    }),
  );

  const items = useMemo(() => data.pages.flatMap((page) => page.items), [data.pages]);
  const registerCta = useMemo(() => <RegisterDeviceDialog orgId={orgId} />, [orgId]);
  const inviteCta = useMemo(() => <InviteDeviceDialog orgId={orgId} />, [orgId]);

  const headerActions = (
    <>
      {inviteCta}
      {registerCta}
    </>
  );

  const filtersActive = classFilter !== "ALL" || teamFilter !== "ALL" || debouncedQuery.length > 0;

  if (items.length === 0 && !filtersActive && search.length === 0) {
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

  const moreSuffix = hasNextPage ? "+" : "";

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Apple devices"
        description="Register UDIDs or invite team members to enroll their devices for ad-hoc builds."
        actions={headerActions}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search by name or UDID…"
              value={search}
              onChange={(event) => {
                handleSearchChange(event.target.value);
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
        <CardFrame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>UDID</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground h-24 text-center">
                    No devices match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    orgId={orgId}
                    teamLabels={teamLabels}
                  />
                ))
              )}
            </TableBody>
          </Table>
          <CardFrameFooter className="text-muted-foreground items-center justify-between text-sm">
            <span>
              {items.length}
              {moreSuffix} loaded
            </span>
            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={async () => {
                  await fetchNextPage();
                }}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            )}
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/apple-devices/")({
  component: Devices,
});
