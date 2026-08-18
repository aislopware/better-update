import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";

import type {
  AppleDistributionCertificateItem,
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
} from "@better-update/api-client/react";

import { CopyableId, CopyableMono } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { RelativeTime } from "../../../lib/relative-time";
import {
  BindingRowActions,
  BoundProjectsCell,
  InheritedProjectsCell,
} from "./-credential-bindings";
import { ExpiryCell, RolesCell, TeamCell } from "./-credential-cells";
import { AppleChildProtectionSwitch, AppleTeamProtectionSwitch } from "./-credential-protection";
import { formatAppleTeamLabel, formatAppleTeamType } from "./-credentials-utils";

import type { ChildCredentialTableProps } from "./-credentials-utils";

export const DISTRIBUTION_CERTIFICATES_EMPTY_HINT =
  "Upload a .p12 from the CLI to sign iOS builds.";

export const DistributionCertificatesTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly AppleDistributionCertificateItem[];
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Serial</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead>Uploaded</TableHead>
        <TableHead className="text-right">Protected</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          {/* No certificate-kind column: this table is the iOS certificates
              only, and macOS ones have their own panel that leads with the
              kind — see ./-credentials-tables-certs. */}
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <CopyableMono value={cert.serialNumber} label="Serial" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(cert.appleTeamId)} />
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
              kind="distributionCertificate"
              id={cert.id}
              label={cert.serialNumber}
              isProtected={cert.protected}
              canManage={canManageProtection}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const PUSH_KEYS_EMPTY_HINT =
  "Upload an APNs .p8 key from the CLI to send push notifications.";

export const PushKeysTable = ({
  items,
  orgId,
  teamsById,
  canManageProtection,
}: ChildCredentialTableProps & {
  items: readonly ApplePushKeyItem[];
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Key ID</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Uploaded</TableHead>
        <TableHead className="text-right">Protected</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <CopyableMono value={key.keyId} label="Key ID" />
          </TableCell>
          <TableCell>
            <TeamCell team={teamsById.get(key.appleTeamId)} />
          </TableCell>
          <TableCell className="text-kumo-subtle">
            <RelativeTime value={key.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="pushKey"
              id={key.id}
              label={key.keyId}
              isProtected={key.protected}
              canManage={canManageProtection}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const ASC_API_KEYS_EMPTY_HINT =
  "Upload an ASC .p8 key from the CLI to automate App Store Connect operations.";

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
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Key</TableHead>
        <TableHead>Team</TableHead>
        <TableHead>Roles</TableHead>
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
              <span className="truncate font-medium">{key.name}</span>
              {/* Clips rather than pushing the column open — see the same
                  sub-line in the Google service account table. */}
              <span className="text-kumo-subtle flex min-w-0 items-center gap-1 overflow-hidden font-mono text-xs">
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
            <RolesCell roles={key.roles} />
          </TableCell>
          <TableCell>
            {key.appleTeamId === null ? (
              <BoundProjectsCell
                orgId={orgId}
                boundProjectIds={key.boundProjectIds}
                boundToAllProjects={key.boundToAllProjects}
              />
            ) : (
              <InheritedProjectsCell
                orgId={orgId}
                boundProjectIds={key.boundProjectIds}
                boundToAllProjects={key.boundToAllProjects}
              />
            )}
          </TableCell>
          <TableCell className="text-kumo-subtle">
            <RelativeTime value={key.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <AppleChildProtectionSwitch
              orgId={orgId}
              kind="ascApiKey"
              id={key.id}
              label={key.name}
              isProtected={key.protected}
              canManage={canManageProtection}
            />
          </TableCell>
          <TableCell className="text-right">
            {/* Team-scoped keys inherit the team's bindings, so there is
                nothing of their own to bind. */}
            {canManageBindings && key.appleTeamId === null ? (
              <BindingRowActions
                orgId={orgId}
                resourceType="ascApiKey"
                resourceId={key.id}
                resourceLabel={key.name}
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

export const APPLE_TEAMS_EMPTY_HINT =
  "Teams appear automatically when certificates, push keys, or ASC API keys are uploaded.";

export const AppleTeamsTable = ({
  items,
  orgId,
  canManageProtection,
}: {
  items: readonly AppleTeamItem[];
  orgId: string;
  canManageProtection: boolean;
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Team</TableHead>
        <TableHead>Projects</TableHead>
        <TableHead className="text-right">Certs</TableHead>
        <TableHead className="text-right">Push</TableHead>
        <TableHead className="text-right">ASC</TableHead>
        <TableHead className="text-right">Profiles</TableHead>
        <TableHead className="text-right">Devices</TableHead>
        <TableHead className="text-right">Protected</TableHead>
        <TableHead />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((team) => (
        <TableRow key={team.id}>
          {/* Type under the name, the way every other team label in the app
              reads — a column of its own repeated one of two words down it. */}
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{formatAppleTeamLabel(team)}</span>
              <span className="text-kumo-subtle truncate text-xs">
                {formatAppleTeamType(team.appleTeamType)}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <BoundProjectsCell
              orgId={orgId}
              boundProjectIds={team.boundProjectIds}
              boundToAllProjects={team.boundToAllProjects}
            />
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {team.distributionCertificateCount}
          </TableCell>
          <TableCell className="text-right tabular-nums">{team.pushKeyCount}</TableCell>
          <TableCell className="text-right tabular-nums">{team.ascApiKeyCount}</TableCell>
          <TableCell className="text-right tabular-nums">{team.provisioningProfileCount}</TableCell>
          <TableCell className="text-right tabular-nums">{team.deviceCount}</TableCell>
          <TableCell className="text-right">
            <AppleTeamProtectionSwitch orgId={orgId} team={team} canManage={canManageProtection} />
          </TableCell>
          <TableCell className="text-right">
            {canManageProtection ? (
              <BindingRowActions
                orgId={orgId}
                resourceType="appleTeam"
                resourceId={team.id}
                resourceLabel={formatAppleTeamLabel(team)}
                boundProjectIds={team.boundProjectIds}
                boundToAllProjects={team.boundToAllProjects}
              />
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
