import {
  adminUsersQueryKey,
  adminUsersQueryOptions,
  approveUser,
  revokeUser,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
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
import { toastManager } from "@better-update/ui/components/ui/toast";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { SearchIcon, SearchXIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { AdminUserItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ChangeEvent } from "react";

import { PageHeader } from "../../../components/page-header";
import { QueryErrorState } from "../../../components/query-error-state";
import { TableSkeleton } from "../../../components/skeletons";
import { isSuperadminUser } from "../../../lib/access";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  enumParam,
  fireAndForget,
  pageParam,
  queryParam,
  useDebouncedSearch,
} from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import { RelativeTime } from "../../../lib/relative-time";
import { useApiMutation } from "../../../lib/use-api-mutation";

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VALUES = ["all", "pending", "approved"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
};

const adminSearchSchema = z.object({
  page: pageParam(),
  query: queryParam(),
  status: enumParam(STATUS_VALUES, "all"),
});

interface ApprovalVariables {
  readonly userId: string;
  readonly approve: boolean;
}

const StatusBadge = ({ approved }: { approved: boolean }) =>
  approved ? (
    <Badge variant="outline" className="text-success border-success/40">
      Approved
    </Badge>
  ) : (
    <Badge variant="outline" className="text-warning border-warning/40">
      Pending
    </Badge>
  );

const UserCell = ({ user }: { user: AdminUserItem }) => (
  <div className="flex min-w-0 flex-col">
    <span className="text-foreground truncate font-medium">{user.name}</span>
    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
  </div>
);

const buildColumns = (
  onSetApproval: (variables: ApprovalVariables) => void,
  pendingUserId: string | undefined,
): readonly ColumnDef<AdminUserItem>[] => [
  {
    id: "user",
    accessorKey: "email",
    header: "User",
    cell: ({ row }) => <UserCell user={row.original} />,
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) =>
      isSuperadminUser(row.original) ? (
        <Badge>Superadmin</Badge>
      ) : (
        <Badge variant="secondary">User</Badge>
      ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <StatusBadge approved={row.original.approved} />
        {row.original.banned ? <Badge variant="destructive">Banned</Badge> : null}
      </div>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const user = row.original;
      if (isSuperadminUser(user)) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      const isPending = pendingUserId === user.id;
      return user.approved ? (
        <Button
          variant="ghost"
          size="sm"
          loading={isPending}
          onClick={() => {
            onSetApproval({ userId: user.id, approve: false });
          }}
        >
          Revoke
        </Button>
      ) : (
        <Button
          size="sm"
          loading={isPending}
          onClick={() => {
            onSetApproval({ userId: user.id, approve: true });
          }}
        >
          Approve
        </Button>
      );
    },
    meta: { align: "right", stopRowClick: true },
  },
];

const AdminUsers = () => {
  const routeNavigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { page, query: urlQuery, status } = Route.useSearch();

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

  const setApproval = useApiMutation<AdminUserItem, ApprovalVariables>({
    mutationFn: async ({ userId, approve }) => (approve ? approveUser(userId) : revokeUser(userId)),
    onSuccess: async (user, { approve }) => {
      toastManager.add({
        title: approve ? `Approved ${user.email}` : `Revoked ${user.email}`,
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: adminUsersQueryKey });
    },
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...adminUsersQueryOptions({
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { search: urlQuery } : {}),
      ...(status === "all" ? {} : { status }),
    }),
    placeholderData: keepPreviousData,
  });

  const pendingUserId = setApproval.isPending ? setApproval.variables.userId : undefined;

  const columns = useMemo(
    () =>
      buildColumns((variables) => {
        setApproval.mutate(variables);
      }, pendingUserId),
    [setApproval, pendingUserId],
  );

  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const onPageChange = (next: number): void => {
    fireAndForget(routeNavigate({ to: ".", search: (prev) => ({ ...prev, page: next }) }));
  };

  const setStatusFilter = (next: StatusFilter): void => {
    fireAndForget(
      routeNavigate({ to: ".", search: (prev) => ({ ...prev, status: next, page: 1 }) }),
    );
  };

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title="Users" description="Approve who can access Better Update." />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={5} rows={6} />
        )}
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const isFiltered = urlQuery.length > 0 || status !== "all";
  const showsFilteredEmpty = data.total === 0 && isFiltered;
  const showsGlobalEmpty = data.total === 0 && !isFiltered && searchDraft.length === 0;

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "user")}${
    isFiltered ? " (filtered)" : ""
  }`;

  const emptyState = showsGlobalEmpty ? (
    <Card>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle>No users yet</EmptyTitle>
          <EmptyDescription>Users appear here after they sign up.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Card>
  ) : (
    <Card>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle>No users match your filters</EmptyTitle>
          <EmptyDescription>Try a different keyword or status.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Card>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Users" description="Approve who can access Better Update." />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search users"
              placeholder="Search by name or email…"
              type="search"
              value={searchDraft}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                handleSearchChange(event.target.value);
              }}
            />
            {isPlaceholderData ? (
              <InputGroupAddon align="inline-end">
                <Spinner />
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <Select
            items={STATUS_LABELS}
            value={status}
            onValueChange={(next) => {
              if (next !== null) {
                setStatusFilter(next);
              }
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {STATUS_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
        {showsGlobalEmpty || showsFilteredEmpty ? (
          emptyState
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
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/admin")({
  validateSearch: zodValidator(adminSearchSchema),
  beforeLoad: ({ context }) => {
    if (!isSuperadminUser(context.user)) {
      // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed `to` inference
      throw redirect({ to: "/" });
    }
  },
  component: AdminUsers,
});
