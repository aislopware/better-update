import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";

import type { AndroidUploadKeystoreItem } from "@better-update/api-client/react";

import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { RelativeTime } from "../../../lib/relative-time";
import { BindingRowActions, BoundProjectsCell } from "./-credential-bindings";
import { ExpiryCell, FingerprintCell } from "./-credential-cells";
import { AndroidUploadKeystoreProtectionSwitch } from "./-credential-protection";
import { formatKeystoreSubline } from "./-credentials-utils";

export const ANDROID_UPLOAD_KEYSTORES_EMPTY_HINT =
  "Upload a .jks or .p12 keystore from the CLI to sign Android builds.";

export const AndroidUploadKeystoresTable = ({
  items,
  orgId,
  canManageProtection,
}: {
  items: readonly AndroidUploadKeystoreItem[];
  orgId: string;
  canManageProtection: boolean;
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Keystore</TableHead>
        {/* SHA-1 is what Firebase and the Google APIs console ask for; SHA-256
            is what Play App Signing shows. Both are what a reader comes here to
            check a keystore against, so both get a column. */}
        <TableHead>SHA-1</TableHead>
        <TableHead>SHA-256</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead>Uploaded</TableHead>
        <TableHead className="text-right">Protected</TableHead>
        <TableHead />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((keystore) => {
        const subline = formatKeystoreSubline(keystore);
        return (
          <TableRow key={keystore.id}>
            <TableCell className={PRIMARY_COLUMN_CLASS}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{keystore.name ?? keystore.keyAlias}</span>
                {subline === null ? null : (
                  <span className="text-kumo-subtle truncate text-xs">{subline}</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <FingerprintCell value={keystore.sha1Fingerprint} label="SHA-1" />
            </TableCell>
            <TableCell>
              <FingerprintCell value={keystore.sha256Fingerprint} label="SHA-256" />
            </TableCell>
            {/* Null for keystores uploaded before the CLI read the certificate;
                ExpiryCell says "No expiry" for those rather than inventing one. */}
            <TableCell>
              <ExpiryCell validUntil={keystore.validUntil} />
            </TableCell>
            <TableCell>
              <BoundProjectsCell
                orgId={orgId}
                boundProjectIds={keystore.boundProjectIds}
                boundToAllProjects={keystore.boundToAllProjects}
              />
            </TableCell>
            <TableCell className="text-kumo-subtle">
              <RelativeTime value={keystore.createdAt} />
            </TableCell>
            <TableCell className="text-right">
              <AndroidUploadKeystoreProtectionSwitch
                orgId={orgId}
                keystore={keystore}
                canManage={canManageProtection}
              />
            </TableCell>
            <TableCell className="text-right">
              {canManageProtection ? (
                <BindingRowActions
                  orgId={orgId}
                  resourceType="androidUploadKeystore"
                  resourceId={keystore.id}
                  resourceLabel={`the ${keystore.keyAlias} keystore`}
                  boundProjectIds={keystore.boundProjectIds}
                  boundToAllProjects={keystore.boundToAllProjects}
                />
              ) : null}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);
