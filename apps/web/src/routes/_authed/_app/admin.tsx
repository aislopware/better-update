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
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { AdminUserItem } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "../../../components/page-header";
import { QueryErrorState } from "../../../components/query-error-state";
import { TableSkeleton } from "../../../components/skeletons";
import { isSuperadminUser } from "../../../lib/access";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  DataTableView,
  PAGE_SIZE,
  computePagination,
  enumArrayParam,
  fireAndForget,
  pageParam,
  queryParam,
  useDebouncedSearch,
} from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import { RelativeTime } from "../../../lib/relative-time";
import { useApiMutation } from "../../../lib/use-api-mutation";

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VALUES = ["pending", "approved"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

// An empty (or full) chip selection means "all statuses".
const STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
] as const;

const isStatusFilter = (value: unknown): value is StatusFilter =>
  (STATUS_VALUES as readonly unknown[]).includes(value);

const adminSearchSchema = z.object({
  page: pageParam(),
  query: queryParam(),
  status: enumArrayParam(STATUS_VALUES),
});

interface ApprovalVariables {
  readonly userId: string;
  readonly approve: boolean;
}

const StatusBadge = ({ approved }: { approved: boolean }) =>
  approved ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Pending</Badge>;

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
          disabled={isPending}
          onClick={() => {
            onSetApproval({ userId: user.id, approve: false });
          }}
        >
          {isPending && <Spinner data-icon="inline-start" />}
          Revoke
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            onSetApproval({ userId: user.id, approve: true });
          }}
        >
          {isPending && <Spinner data-icon="inline-start" />}
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
      toast.success(approve ? `Approved ${user.email}` : `Revoked ${user.email}`);
      await queryClient.invalidateQueries({ queryKey: adminUsersQueryKey });
    },
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...adminUsersQueryOptions({
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { search: urlQuery } : {}),
      // Both statuses selected ≡ no filter — the API keeps its tri-state param.
      ...(status.length === 1 ? { status: status[0] } : {}),
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

  const setStatusFilter = (next: readonly StatusFilter[]): void => {
    fireAndForget(
      routeNavigate({ to: ".", search: (prev) => ({ ...prev, status: [...next], page: 1 }) }),
    );
  };

  const handleReset = (): void => {
    handleSearchChange("");
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, query: "", status: [], page: 1 }),
        replace: true,
      }),
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

  const isFiltered = urlQuery.length > 0 || status.length > 0;
  const showsGlobalEmpty = data.total === 0 && !isFiltered && searchDraft.length === 0;

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "user")}${
    isFiltered ? " (filtered)" : ""
  }`;

  const emptyState = (
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
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Users" description="Approve who can access Better Update." />
      <div className="flex flex-col gap-3">
        <DataTableToolbar
          search={{
            value: searchDraft,
            onChange: handleSearchChange,
            placeholder: "Search by name or email…",
          }}
          isFiltered={isFiltered}
          onReset={handleReset}
        >
          <DataTableFacetedFilter
            title="Status"
            options={STATUS_OPTIONS}
            selected={status}
            onChange={(next) => {
              setStatusFilter(next.filter(isStatusFilter));
            }}
          />
        </DataTableToolbar>
        {showsGlobalEmpty ? (
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
            emptyMessage="No users match your filters."
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
