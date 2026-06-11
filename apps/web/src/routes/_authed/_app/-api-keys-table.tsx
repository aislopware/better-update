import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { KeyIcon, ShieldIcon, Trash2Icon, EllipsisVerticalIcon } from "lucide-react";
import { useMemo } from "react";

import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { DataTableView } from "../../../lib/data-table";
import { formatRelativeFuture } from "../../../lib/format-relative-time";
import { RelativeTime } from "../../../lib/relative-time";

import type { ApiKeyItem } from "../../../queries/api-keys";

const maskKey = (start: string | null, prefix: string | null): string => {
  if (start) {
    return `${start}${"•".repeat(8)}`;
  }
  if (prefix) {
    return `${prefix}${"•".repeat(12)}`;
  }
  return "••••";
};

const KeyActions = ({
  onManagePolicies,
  onRevoke,
}: {
  onManagePolicies: () => void;
  onRevoke: () => void;
}) => (
  <Menu>
    <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="Key actions" />}>
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuGroup>
        <MenuItem onClick={onManagePolicies}>
          <ShieldIcon strokeWidth={2} />
          <span>Manage policies</span>
        </MenuItem>
        <MenuItem variant="destructive" onClick={onRevoke}>
          <Trash2Icon strokeWidth={2} />
          <span>Revoke key</span>
        </MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

const NameCell = ({ apiKey }: { apiKey: ApiKeyItem }) => (
  <div className="flex items-center gap-3">
    <span className="bg-muted/72 flex size-9 shrink-0 items-center justify-center rounded-md border">
      <KeyIcon strokeWidth={2} className="size-4" />
    </span>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-sm leading-none font-medium">
        <span className="truncate">{apiKey.name ?? "Unnamed key"}</span>
        {apiKey.enabled ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        )}
      </span>
      <code className="text-muted-foreground truncate font-mono text-xs">
        {maskKey(apiKey.start, apiKey.prefix)}
      </code>
    </div>
  </div>
);

const buildColumns = (
  onManagePolicies: (keyId: string) => void,
  onRevoke: (keyId: string) => void,
): readonly ColumnDef<ApiKeyItem>[] => [
  {
    id: "name",
    header: "Key",
    cell: ({ row }) => <NameCell apiKey={row.original} />,
    enableSorting: false,
  },
  {
    id: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "expiresAt",
    header: "Expires",
    cell: ({ row }) =>
      row.original.expiresAt ? (
        formatRelativeFuture(row.original.expiresAt)
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <KeyActions
          onManagePolicies={() => {
            onManagePolicies(row.original.id);
          }}
          onRevoke={() => {
            onRevoke(row.original.id);
          }}
        />
      </div>
    ),
    enableSorting: false,
    meta: { align: "right" },
  },
];

export const ApiKeysTable = ({
  apiKeys,
  countLabel,
  onManagePolicies,
  onRevoke,
}: {
  apiKeys: readonly ApiKeyItem[];
  countLabel: string;
  onManagePolicies: (keyId: string) => void;
  onRevoke: (keyId: string) => void;
}) => {
  const columns = useMemo(
    () => buildColumns(onManagePolicies, onRevoke),
    [onManagePolicies, onRevoke],
  );
  const tableData = useMemo(() => [...apiKeys], [apiKeys]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  return <DataTableView table={table} columnsCount={columns.length} countLabel={countLabel} />;
};

export const ApiKeysEmptyState = ({ children }: { children?: ReactNode }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>Create your first API key</EmptyTitle>
        <EmptyDescription>
          API keys let other apps and the CLI talk to your organization securely.
        </EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  </Card>
);
