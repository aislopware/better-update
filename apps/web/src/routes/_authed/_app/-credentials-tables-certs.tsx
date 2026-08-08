import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";

import type {
  ApplePassTypeCertificateItem,
  ApplePayCertificateItem,
  ApplePushCertificateItem,
} from "@better-update/api-client/react";

import { CopyableMono } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { RelativeTime } from "../../../lib/relative-time";
import { CredentialEmptyRow, ExpiryCell, TeamCell } from "./-credential-cells";
import { AppleChildProtectionSwitch } from "./-credential-protection";

import type { AppleChildProtectionKind } from "./-credential-protection";
import type { ChildCredentialTableProps } from "./-credentials-utils";

// Push / Apple Pay / Pass Type ID certificate tables, extracted from
// ./-credentials-tables for the max-lines budget (mirroring
// ./-credentials-tables-google).

// All three are the same row wearing three different identifiers, so they share
// one table: what the certificate is for, whose team it belongs to, its serial,
// when it expires, when it arrived — and the protection switch last, where every
// other list keeps its controls.
interface AppleCertificateLike {
  readonly id: string;
  readonly appleTeamId: string;
  readonly protected: boolean;
  readonly serialNumber: string;
  readonly validUntil: string;
  readonly createdAt: string;
}

const AppleCertificateTable = <TCert extends AppleCertificateLike>({
  items,
  orgId,
  teamsById,
  canManageProtection,
  kind,
  primaryHeader,
  primaryOf,
}: ChildCredentialTableProps & {
  items: readonly TCert[];
  kind: AppleChildProtectionKind;
  primaryHeader: string;
  primaryOf: (cert: TCert) => string;
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>{primaryHeader}</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Serial</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Created</TableHead>
        <TableHead className="text-right">Protected</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <CopyableMono value={primaryOf(cert)} label={primaryHeader} />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(cert.appleTeamId)} />
          </TableCell>
          <TableCell>
            <CopyableMono value={cert.serialNumber} label="Serial" />
          </TableCell>
          <TableCell>
            <ExpiryCell validUntil={cert.validUntil} />
          </TableCell>
          <TableCell className="text-kumo-subtle">
            <RelativeTime value={cert.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind={kind}
              id={cert.id}
              label={primaryOf(cert)}
              isProtected={cert.protected}
              canManage={canManageProtection}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

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
}: ChildCredentialTableProps & { items: readonly ApplePushCertificateItem[] }) => (
  <AppleCertificateTable
    items={items}
    orgId={orgId}
    teamsById={teamsById}
    canManageProtection={canManageProtection}
    kind="pushCertificate"
    primaryHeader="Bundle identifier"
    primaryOf={(cert) => cert.bundleIdentifier}
  />
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
}: ChildCredentialTableProps & { items: readonly ApplePayCertificateItem[] }) => (
  <AppleCertificateTable
    items={items}
    orgId={orgId}
    teamsById={teamsById}
    canManageProtection={canManageProtection}
    kind="payCertificate"
    primaryHeader="Merchant ID"
    primaryOf={(cert) => cert.merchantIdentifier}
  />
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
}: ChildCredentialTableProps & { items: readonly ApplePassTypeCertificateItem[] }) => (
  <AppleCertificateTable
    items={items}
    orgId={orgId}
    teamsById={teamsById}
    canManageProtection={canManageProtection}
    kind="passTypeCertificate"
    primaryHeader="Pass Type ID"
    primaryOf={(cert) => cert.passTypeIdentifier}
  />
);
