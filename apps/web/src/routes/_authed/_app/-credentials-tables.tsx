import { Badge } from "@better-update/ui/components/ui/badge";
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
import {
  BellRingIcon,
  CloudIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react";

import type {
  AppleDistributionCertificateItem,
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
  GoogleServiceAccountKeyItem,
} from "@better-update/api-client/react";

import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "../../../lib/credential-status";
import { formatDate } from "../../../lib/format-date";
import { formatAppleTeamLabel } from "./-credentials-utils";

export const DistributionCertificatesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ShieldCheckIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No distribution certificates</EmptyTitle>
      <EmptyDescription>
        Use the CLI to upload a .p12 certificate to sign iOS builds for the App Store or ad-hoc
        distribution.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const DistributionCertificatesTable = ({
  items,
}: {
  items: readonly AppleDistributionCertificateItem[];
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Serial</TableHead>
        <TableHead>Valid until</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => {
        const status = deriveExpiryStatus(cert.validUntil);
        return (
          <TableRow key={cert.id}>
            <TableCell className="font-mono text-xs">{cert.serialNumber}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span>{formatDate(cert.validUntil)}</span>
                <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

export const PushKeysEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <BellRingIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No push keys</EmptyTitle>
      <EmptyDescription>
        Use the CLI to upload an APNs .p8 key to send push notifications from the Apple Push
        Notification service.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const PushKeysTable = ({ items }: { items: readonly ApplePushKeyItem[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Key ID</TableHead>
        <TableHead>Added</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell>{formatDate(key.createdAt)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AscApiKeysEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <KeyRoundIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No App Store Connect API keys</EmptyTitle>
      <EmptyDescription>
        Use the CLI to upload an ASC .p8 key to automate App Store Connect operations.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const AscApiKeysTable = ({ items }: { items: readonly AscApiKeyItem[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Key ID</TableHead>
        <TableHead>Issuer ID</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-medium">{key.name}</TableCell>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell className="font-mono text-xs break-all">{key.issuerId}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AppleTeamsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <UsersRoundIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No Apple Teams yet</EmptyTitle>
      <EmptyDescription>
        Apple Teams are auto-derived from uploaded certificates, push keys, and ASC API keys.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const AppleTeamsTable = ({ items }: { items: readonly AppleTeamItem[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Team</TableHead>
        <TableHead>Type</TableHead>
        <TableHead className="text-right">Certs</TableHead>
        <TableHead className="text-right">Push</TableHead>
        <TableHead className="text-right">ASC</TableHead>
        <TableHead className="text-right">Profiles</TableHead>
        <TableHead className="text-right">Devices</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((team) => (
        <TableRow key={team.id}>
          <TableCell className="font-medium">{formatAppleTeamLabel(team)}</TableCell>
          <TableCell className="text-muted-foreground">{team.appleTeamType}</TableCell>
          <TableCell className="text-right">{team.distributionCertificateCount}</TableCell>
          <TableCell className="text-right">{team.pushKeyCount}</TableCell>
          <TableCell className="text-right">{team.ascApiKeyCount}</TableCell>
          <TableCell className="text-right">{team.provisioningProfileCount}</TableCell>
          <TableCell className="text-right">{team.deviceCount}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const GoogleServiceAccountKeysEmptyState = () => (
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
);

export const GoogleServiceAccountKeysTable = ({
  items,
}: {
  items: readonly GoogleServiceAccountKeyItem[];
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Client email</TableHead>
        <TableHead>Project</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="text-xs">{key.clientEmail}</TableCell>
          <TableCell className="font-mono text-xs">{key.googleProjectId}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
