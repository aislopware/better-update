import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";

import type {
  ApplePassTypeCertificateItem,
  ApplePayCertificateItem,
  ApplePushCertificateItem,
} from "@better-update/api-client/react";

import { CopyableMono } from "../../../lib/copy-button";
import { formatShortDate } from "../../../lib/format-date";
import { RelativeTime } from "../../../lib/relative-time";
import { CredentialEmptyRow, TeamCell } from "./-credential-cells";
import { AppleChildProtectionSwitch } from "./-credential-protection";

import type { ChildCredentialTableProps } from "./-credentials-utils";

// Push / Apple Pay / Pass Type ID certificate tables, extracted from
// ./-credentials-tables for the max-lines budget (mirroring
// ./-credentials-tables-google).

export const PushCertificatesEmptyState = () => (
  <CredentialEmptyRow>
    No push certificates yet — upload a legacy APNs Push Services .p12 from the CLI if you still
    need one.
  </CredentialEmptyRow>
);

export const PushCertificatesTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly ApplePushCertificateItem[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Bundle identifier</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Serial number</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Created</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          <TableCell>
            <CopyableMono value={cert.bundleIdentifier} label="Bundle identifier" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(cert.appleTeamId)} />
          </TableCell>
          <TableCell>
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="pushCertificate"
              id={cert.id}
              label={cert.serialNumber}
              isProtected={cert.protected}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell>
            <CopyableMono value={cert.serialNumber} label="Serial number" />
          </TableCell>
          <TableCell>{formatShortDate(cert.validUntil)}</TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={cert.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const PayCertificatesEmptyState = () => (
  <CredentialEmptyRow>
    No Apple Pay certificates yet — upload a payment processing .p12 bound to a Merchant ID from the
    CLI.
  </CredentialEmptyRow>
);

export const PayCertificatesTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly ApplePayCertificateItem[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Merchant ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Serial</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Created</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          <TableCell>
            <CopyableMono value={cert.merchantIdentifier} label="Merchant ID" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(cert.appleTeamId)} />
          </TableCell>
          <TableCell>
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="payCertificate"
              id={cert.id}
              label={cert.merchantIdentifier}
              isProtected={cert.protected}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell>
            <CopyableMono value={cert.serialNumber} label="Serial" />
          </TableCell>
          <TableCell>{formatShortDate(cert.validUntil)}</TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={cert.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const PassTypeCertificatesEmptyState = () => (
  <CredentialEmptyRow>
    No Pass Type ID certificates yet — upload a Wallet .p12 bound to a Pass Type ID from the CLI.
  </CredentialEmptyRow>
);

export const PassTypeCertificatesTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly ApplePassTypeCertificateItem[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Pass Type ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Serial</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Created</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          <TableCell>
            <CopyableMono value={cert.passTypeIdentifier} label="Pass Type ID" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(cert.appleTeamId)} />
          </TableCell>
          <TableCell>
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="passTypeCertificate"
              id={cert.id}
              label={cert.passTypeIdentifier}
              isProtected={cert.protected}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell>
            <CopyableMono value={cert.serialNumber} label="Serial" />
          </TableCell>
          <TableCell>{formatShortDate(cert.validUntil)}</TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={cert.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
