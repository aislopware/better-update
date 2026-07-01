import { meQueryOptions, robotAccountsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { Suspense } from "react";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { PageHeader } from "../../../components/page-header";
import { TableSkeleton } from "../../../components/skeletons";
import { RelativeTime } from "../../../lib/relative-time";
import { RobotRowActions } from "./-robot-row-actions";

const RobotAccountsEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No robot accounts yet</EmptyTitle>
        <EmptyDescription>
          Robot accounts are created from the CLI: run{" "}
          <code className="font-mono text-xs">better-update credentials robot create</code> from an
          admin device.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const RobotAccountsTable = ({
  orgId,
  items,
  canManagePolicies,
}: {
  orgId: string;
  items: readonly RobotAccountItem[];
  canManagePolicies: boolean;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Bearer</TableHead>
        <TableHead>Vault access</TableHead>
        <TableHead>Created</TableHead>
        {canManagePolicies ? <TableHead className="w-0" /> : null}
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((robot) => (
        <TableRow key={robot.id}>
          <TableCell className="font-medium">{robot.name}</TableCell>
          <TableCell className="text-muted-foreground font-mono text-xs">
            {robot.bearerStart === null ? "— not minted —" : `${robot.bearerStart}···`}
          </TableCell>
          <TableCell>
            <Badge variant={robot.userEncryptionKeyId === null ? "outline" : "default"}>
              {robot.userEncryptionKeyId === null ? "No" : "Yes"}
            </Badge>
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={robot.createdAt} />
          </TableCell>
          {canManagePolicies ? (
            <TableCell className="text-right">
              <RobotRowActions
                orgId={orgId}
                robotId={robot.id}
                robotName={robot.name}
                canManagePolicies={canManagePolicies}
              />
            </TableCell>
          ) : null}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const RobotAccountsContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const { data: items } = useSuspenseQuery(robotAccountsQueryOptions(activeOrg.id));
  const { data: me } = useSuspenseQuery(meQueryOptions());

  if (items.length === 0) {
    return <RobotAccountsEmptyState />;
  }

  return (
    <Frame>
      <RobotAccountsTable
        orgId={activeOrg.id}
        items={items}
        canManagePolicies={me.canManagePolicies}
      />
    </Frame>
  );
};

const RobotAccounts = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Robot accounts"
      description="Org-owned CI identities — a bearer secret for API auth and a vault identity in one. Created, rotated, and revoked exclusively from the CLI."
    />
    <Suspense fallback={<TableSkeleton columns={4} rows={3} hasFooter={false} />}>
      <RobotAccountsContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/robot-accounts")({
  component: RobotAccounts,
});
