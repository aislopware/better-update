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
import { KeyIcon, ShieldIcon, Trash2Icon, EllipsisVerticalIcon } from "lucide-react";

import type { ReactNode } from "react";

import { formatRelativeFuture, formatRelativeTime } from "../../../lib/format-relative-time";

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

export const ApiKeysTable = ({
  apiKeys,
  onManagePolicies,
  onRevoke,
}: {
  apiKeys: readonly ApiKeyItem[];
  onManagePolicies: (keyId: string) => void;
  onRevoke: (keyId: string) => void;
}) => (
  <ul className="flex flex-col divide-y">
    {apiKeys.map((key) => (
      <li key={key.id} className="flex items-center gap-4 px-6 py-4">
        <span className="bg-muted/72 flex size-9 shrink-0 items-center justify-center rounded-md border">
          <KeyIcon strokeWidth={2} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm leading-none font-medium">
            <span className="truncate">{key.name ?? "Unnamed key"}</span>
            {key.enabled ? null : (
              <Badge variant="outline" className="text-muted-foreground">
                Disabled
              </Badge>
            )}
          </span>
          <code className="text-muted-foreground truncate font-mono text-xs">
            {maskKey(key.start, key.prefix)}
          </code>
        </div>
        <div className="text-muted-foreground hidden flex-col items-end gap-0.5 text-xs sm:flex">
          <span>Created {formatRelativeTime(new Date(key.createdAt).toISOString())}</span>
          <span>
            {key.expiresAt
              ? `Expires ${formatRelativeFuture(new Date(key.expiresAt).toISOString())}`
              : "Never expires"}
          </span>
        </div>
        <KeyActions
          onManagePolicies={() => {
            onManagePolicies(key.id);
          }}
          onRevoke={() => {
            onRevoke(key.id);
          }}
        />
      </li>
    ))}
  </ul>
);

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
