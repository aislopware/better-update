import { Badge } from "@better-update/ui/components/ui/badge";
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
import { formatShortDate } from "../../../lib/format-date";
import { EmptyDash, RolesCell, TeamCell } from "./-credential-cells";
import { formatAppleTeamLabel, formatAppleTeamType } from "./-credentials-utils";

export const DistributionCertificatesEmptyState = () => (
  <Card>
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
  </Card>
);

export const DistributionCertificatesTable = ({
  items,
  teamsById,
}: {
  items: readonly AppleDistributionCertificateItem[];
  teamsById: ReadonlyMap<string, AppleTeamItem>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Serial</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Developer ID</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Valid until</TableHead>
        <TableHead>Uploaded</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => {
        const status = deriveExpiryStatus(cert.validUntil);
        return (
          <TableRow key={cert.id}>
            <TableCell className="font-mono text-xs break-all">{cert.serialNumber}</TableCell>
            <TableCell>
              <TeamCell team={teamsById.get(cert.appleTeamId)} />
            </TableCell>
            <TableCell className="font-mono text-xs">
              {cert.developerIdIdentifier ?? <EmptyDash />}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>
            </TableCell>
            <TableCell>{formatShortDate(cert.validUntil)}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDate(cert.createdAt)}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

export const PushKeysEmptyState = () => (
  <Card>
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
  </Card>
);

export const PushKeysTable = ({
  items,
  teamsById,
}: {
  items: readonly ApplePushKeyItem[];
  teamsById: ReadonlyMap<string, AppleTeamItem>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Key ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Added</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(key.appleTeamId)} />
          </TableCell>
          <TableCell className="text-muted-foreground">{formatShortDate(key.createdAt)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AscApiKeysEmptyState = () => (
  <Card>
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
  </Card>
);

export const AscApiKeysTable = ({
  items,
  teamsById,
}: {
  items: readonly AscApiKeyItem[];
  teamsById: ReadonlyMap<string, AppleTeamItem>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Key ID</TableHead>
        <TableHead>Issuer ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Roles</TableHead>
        <TableHead>Added</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-medium">{key.name}</TableCell>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell className="font-mono text-xs break-all">{key.issuerId}</TableCell>
          <TableCell>
            <TeamCell
              team={key.appleTeamId === null ? undefined : teamsById.get(key.appleTeamId)}
            />
          </TableCell>
          <TableCell>
            <RolesCell roles={key.roles} />
          </TableCell>
          <TableCell className="text-muted-foreground">{formatShortDate(key.createdAt)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AppleTeamsEmptyState = () => (
  <Card>
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
  </Card>
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
          <TableCell className="text-muted-foreground">
            {formatAppleTeamType(team.appleTeamType)}
          </TableCell>
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
}: {
  items: readonly GoogleServiceAccountKeyItem[];
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Client email</TableHead>
        <TableHead>Project</TableHead>
        <TableHead>Key ID</TableHead>
        <TableHead>Added</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="text-xs">{key.clientEmail}</TableCell>
          <TableCell className="font-mono text-xs">{key.googleProjectId}</TableCell>
          <TableCell className="font-mono text-xs break-all">{key.privateKeyId}</TableCell>
          <TableCell className="text-muted-foreground">{formatShortDate(key.createdAt)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
