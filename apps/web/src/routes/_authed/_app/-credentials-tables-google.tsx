import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { CopyButton, CopyableId } from "../../../lib/copy-button";
import { RelativeTime } from "../../../lib/relative-time";
import { BoundProjectsCell } from "./-credential-bindings";
import { CredentialEmptyRow } from "./-credential-cells";
import { GsaKeyProtectionSwitch } from "./-credential-protection";

export const GoogleServiceAccountKeysEmptyState = () => (
  <CredentialEmptyRow>
    No Google service account keys yet — upload a service account .json from the CLI for FCM v1 push
    notifications.
  </CredentialEmptyRow>
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
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Service account</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead>Uploaded</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell>
            <div className="flex max-w-96 flex-col gap-0.5">
              <span
                className="flex items-center gap-1"
                title={key.clientId === null ? undefined : `Client ID: ${key.clientId}`}
              >
                <span className="truncate font-mono text-xs font-medium">{key.clientEmail}</span>
                <CopyButton value={key.clientEmail} label="Client email" size="icon-xs" />
              </span>
              <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
                <CopyableId value={key.googleProjectId} label="Project ID" length={16} />
                <span aria-hidden>·</span>
                <CopyableId value={key.privateKeyId} label="Private key ID" />
              </span>
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
              boundToAllProjects={key.boundToAllProjects}
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
