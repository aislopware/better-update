import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";

import type {
  AppleDistributionCertificateItem,
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
} from "@better-update/api-client/react";

import { CopyableId, CopyableMono } from "../../../lib/copy-button";
import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "../../../lib/credential-status";
import { formatShortDate } from "../../../lib/format-date";
import { RelativeTime } from "../../../lib/relative-time";
import { BoundProjectsCell, InheritedProjectsCell } from "./-credential-bindings";
import { CredentialEmptyRow, RolesCell, TeamCell } from "./-credential-cells";
import { AppleChildProtectionSwitch, AppleTeamProtectionSwitch } from "./-credential-protection";
import { formatAppleTeamLabel, formatAppleTeamType } from "./-credentials-utils";

import type { ChildCredentialTableProps } from "./-credentials-utils";

export const DistributionCertificatesEmptyState = () => (
  <CredentialEmptyRow>
    No distribution certificates yet — upload a .p12 from the CLI to sign iOS builds.
  </CredentialEmptyRow>
);

export const DistributionCertificatesTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly AppleDistributionCertificateItem[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Serial</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
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
            <TableCell>
              <CopyableMono value={cert.serialNumber} label="Serial" />
            </TableCell>
            <TableCell>
              <TeamCell team={teamsById.get(cert.appleTeamId)} />
            </TableCell>
            <TableCell>
              <AppleChildProtectionSwitch
                orgId={orgId}
                kind="distributionCertificate"
                id={cert.id}
                label={cert.serialNumber}
                isProtected={cert.protected}
                canManage={canManageProtection}
              />
            </TableCell>
            <TableCell>
              <CopyableMono value={cert.developerIdIdentifier} label="Developer ID" />
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>
            </TableCell>
            <TableCell>{formatShortDate(cert.validUntil)}</TableCell>
            <TableCell className="text-muted-foreground">
              <RelativeTime value={cert.createdAt} />
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

export const PushKeysEmptyState = () => (
  <CredentialEmptyRow>
    No push keys yet — upload an APNs .p8 key from the CLI to send push notifications.
  </CredentialEmptyRow>
);

export const PushKeysTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly ApplePushKeyItem[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Key ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Uploaded</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell>
            <CopyableMono value={key.keyId} label="Key ID" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(key.appleTeamId)} />
          </TableCell>
          <TableCell>
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="pushKey"
              id={key.id}
              label={key.keyId}
              isProtected={key.protected}
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

export const AscApiKeysEmptyState = () => (
  <CredentialEmptyRow>
    No App Store Connect API keys yet — upload an ASC .p8 key from the CLI to automate App Store
    Connect operations.
  </CredentialEmptyRow>
);

export const AscApiKeysTable = ({
  items,
  teamsById,
  orgId,
  canManageBindings,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly AscApiKeyItem[];
  canManageBindings: boolean;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Key</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Roles</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead>Uploaded</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell>
            <div className="flex max-w-72 flex-col gap-0.5">
              <span className="truncate font-medium">{key.name}</span>
              <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
                <CopyableId value={key.keyId} label="Key ID" length={10} />
                <span aria-hidden>·</span>
                <CopyableId value={key.issuerId} label="Issuer ID" />
              </span>
            </div>
          </TableCell>
          <TableCell>
            <TeamCell
              team={key.appleTeamId === null ? undefined : teamsById.get(key.appleTeamId)}
            />
          </TableCell>
          <TableCell>
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="ascApiKey"
              id={key.id}
              label={key.name}
              isProtected={key.protected}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell>
            <RolesCell roles={key.roles} />
          </TableCell>
          <TableCell>
            {key.appleTeamId === null ? (
              <BoundProjectsCell
                orgId={orgId}
                resourceType="ascApiKey"
                resourceId={key.id}
                resourceLabel={key.name}
                boundProjectIds={key.boundProjectIds}
                boundToAllProjects={key.boundToAllProjects}
                canManage={canManageBindings}
              />
            ) : (
              <InheritedProjectsCell
                orgId={orgId}
                boundProjectIds={key.boundProjectIds}
                boundToAllProjects={key.boundToAllProjects}
              />
            )}
          </TableCell>
          <TableCell className="text-muted-foreground">
            <RelativeTime value={key.createdAt} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AppleTeamsEmptyState = () => (
  <CredentialEmptyRow>
    No Apple Teams yet — teams appear automatically when certificates, push keys, or ASC API keys
    are uploaded.
  </CredentialEmptyRow>
);

export const AppleTeamsTable = ({
  items,
  orgId,
  canManageProtection,
}: {
  items: readonly AppleTeamItem[];
  orgId: string;
  canManageProtection: boolean;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Team</TableHead>
        <TableHead>Type</TableHead>
        <TableHead>Protected</TableHead>
        <TableHead>Projects</TableHead>
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
          <TableCell>
            <AppleTeamProtectionSwitch orgId={orgId} team={team} canManage={canManageProtection} />
          </TableCell>
          <TableCell>
            <BoundProjectsCell
              orgId={orgId}
              resourceType="appleTeam"
              resourceId={team.id}
              resourceLabel={formatAppleTeamLabel(team)}
              boundProjectIds={team.boundProjectIds}
              boundToAllProjects={team.boundToAllProjects}
              canManage={canManageProtection}
            />
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
