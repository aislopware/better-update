import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { CopyButton, CopyableId } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { RelativeTime } from "../../../lib/relative-time";
import { BindingRowActions, BoundProjectsCell } from "./-credential-bindings";
import { GsaKeyProtectionSwitch } from "./-credential-protection";

export const GOOGLE_SERVICE_ACCOUNT_KEYS_EMPTY_HINT =
  "Upload a service account .json from the CLI for FCM v1 push notifications.";

export const GoogleServiceAccountKeysTable = ({
  items,
  orgId,
  canManageProtection,
}: {
  items: readonly GoogleServiceAccountKeyItem[];
  orgId: string;
  canManageProtection: boolean;
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Service account</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead>Uploaded</TableHead>
        <TableHead className="text-right">Protected</TableHead>
        <TableHead />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className="flex items-center gap-1"
                title={key.clientId === null ? undefined : `Client ID: ${key.clientId}`}
              >
                <span className="truncate font-mono text-xs font-medium">{key.clientEmail}</span>
                <CopyButton value={key.clientEmail} label="Client email" size="xs" />
              </span>
              <span className="text-kumo-subtle flex items-center gap-1 font-mono text-xs">
                <CopyableId value={key.googleProjectId} label="Project ID" length={16} />
                <span aria-hidden>·</span>
                <CopyableId value={key.privateKeyId} label="Private key ID" />
              </span>
            </div>
          </TableCell>
          <TableCell>
            <BoundProjectsCell
              orgId={orgId}
              boundProjectIds={key.boundProjectIds}
              boundToAllProjects={key.boundToAllProjects}
            />
          </TableCell>
          <TableCell className="text-kumo-subtle">
            <RelativeTime value={key.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <GsaKeyProtectionSwitch orgId={orgId} gsaKey={key} canManage={canManageProtection} />
          </TableCell>
          <TableCell className="text-right">
            {canManageProtection ? (
              <BindingRowActions
                orgId={orgId}
                resourceType="googleServiceAccountKey"
                resourceId={key.id}
                resourceLabel={key.clientEmail}
                boundProjectIds={key.boundProjectIds}
                boundToAllProjects={key.boundToAllProjects}
              />
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
