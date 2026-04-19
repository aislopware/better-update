import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { KeyIcon, Trash2Icon, EllipsisVerticalIcon } from "lucide-react";

import type { ApiKeyItem } from "../../../queries/api-keys";

const maskKey = (start: string | null, prefix: string | null): string => {
  if (start) {
    return `${start}${"*".repeat(8)}`;
  }
  if (prefix) {
    return `${prefix}${"*".repeat(12)}`;
  }
  return "****";
};

const KeyActions = ({ onRevoke }: { onRevoke: () => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger>
      <Button variant="ghost" size="icon-sm">
        <EllipsisVerticalIcon strokeWidth={2} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuGroup>
        <DropdownMenuItem className="text-destructive" onClick={onRevoke}>
          <Trash2Icon strokeWidth={2} />
          <span>Revoke key</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const ApiKeysTable = ({
  apiKeys,
  onRevoke,
}: {
  apiKeys: ApiKeyItem[];
  onRevoke: (keyId: string) => void;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Key</TableHead>
        <TableHead>Created</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {apiKeys.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-medium">{key.name ?? "Unnamed"}</TableCell>
          <TableCell>
            <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
              {maskKey(key.start, key.prefix)}
            </code>
          </TableCell>
          <TableCell className="text-muted-foreground">
            {new Date(key.createdAt).toLocaleDateString()}
          </TableCell>
          <TableCell>
            {key.expiresAt ? (
              <Badge variant="outline">{new Date(key.expiresAt).toLocaleDateString()}</Badge>
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </TableCell>
          <TableCell>
            <KeyActions
              onRevoke={() => {
                onRevoke(key.id);
              }}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const ApiKeysEmptyState = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <KeyIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No API keys</EmptyTitle>
      <EmptyDescription>
        Create an API key to authenticate requests to the management API.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);
