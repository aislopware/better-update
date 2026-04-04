import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { Key01Icon, Delete02Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "../../../lib/auth-client";
import { apiKeysQueryOptions } from "../../../queries/api-keys";
import { orgsQueryOptions, sessionQueryOptions } from "../../../queries/auth";
import { CreateApiKeyDialog, RevokeDialog } from "./-api-key-dialogs";

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
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem className="text-destructive" onClick={onRevoke}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
        <span>Revoke key</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const ApiKeysTable = ({
  apiKeys,
  onRevoke,
}: {
  apiKeys: {
    id: string;
    name: string | null;
    start: string | null;
    prefix: string | null;
    createdAt: Date;
    expiresAt: Date | null;
  }[];
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

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={Key01Icon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No API keys</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create an API key to authenticate requests to the management API.
      </p>
    </CardContent>
  </Card>
);

const ApiKeys = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.user.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data: apiKeys } = useSuspenseQuery(apiKeysQueryOptions(orgId));

  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const handleRevoke = async () => {
    if (!revokeKeyId) {
      return;
    }
    setIsRevoking(true);

    const { error } = await authClient.apiKey.delete({
      keyId: revokeKeyId,
    });

    setIsRevoking(false);

    if (error) {
      toast.error(error.message ?? "Failed to revoke API key");
      return;
    }

    setRevokeKeyId(null);
    toast.success("API key revoked");
    await queryClient.invalidateQueries({
      queryKey: ["org", orgId, "api-keys"],
    });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground mt-1">Manage API keys for programmatic access.</p>
        </div>
        <CreateApiKeyDialog orgId={orgId} />
      </div>

      {apiKeys.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Active keys</CardTitle>
            <CardDescription>
              {apiKeys.length} {apiKeys.length === 1 ? "key" : "keys"} in this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeysTable apiKeys={apiKeys} onRevoke={setRevokeKeyId} />
          </CardContent>
        </Card>
      )}

      <RevokeDialog
        open={revokeKeyId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRevokeKeyId(null);
          }
        }}
        onConfirm={handleRevoke}
        isRevoking={isRevoking}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/api-keys")({
  component: ApiKeys,
});
