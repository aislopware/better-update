import { Card } from "@better-update/ui/components/ui/card";
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
import { CloudIcon } from "lucide-react";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { CopyableMono } from "../../../lib/copy-button";
import { RelativeTime } from "../../../lib/relative-time";
import { BoundProjectsCell } from "./-credential-bindings";
import { GsaKeyProtectionSwitch } from "./-credential-protection";

export const GoogleServiceAccountKeysEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No Google service account keys</EmptyTitle>
        <EmptyDescription>
          Use the CLI to upload a service account .json key for FCM v1 push notifications.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

export const GoogleServiceAccountKeysTable = ({
  items,
  orgId,
  canManageProtection,
}: {
  items: readonly GoogleServiceAccountKeyItem[];
  orgId: string;
  canManageProtection: boolean;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Project ID</TableHead>
        <TableHead>Private Key ID</TableHead>
        <TableHead>Client</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead>Uploaded</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell>
            <CopyableMono value={key.googleProjectId} label="Project ID" />
          </TableCell>
          <TableCell>
            <CopyableMono value={key.privateKeyId} label="Private key ID" />
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <CopyableMono value={key.clientEmail} label="Client email" />
              {key.clientId === null ? null : (
                <span className="text-muted-foreground text-xs">ID: {key.clientId}</span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <GsaKeyProtectionSwitch orgId={orgId} gsaKey={key} canManage={canManageProtection} />
          </TableCell>
          <TableCell>
            <BoundProjectsCell
              orgId={orgId}
              resourceType="googleServiceAccountKey"
              resourceId={key.id}
              resourceLabel={key.clientEmail}
              boundProjectIds={key.boundProjectIds}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={key.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
