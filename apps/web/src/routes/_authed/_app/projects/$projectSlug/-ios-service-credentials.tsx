import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";

import type {
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
} from "@better-update/api-client/react";

import { ProtectedBadgeCell, RolesCell, TeamCell } from "../../-credential-cells";
import { CopyableMono } from "../../../../../lib/copy-button";
import { formatShortDateTime } from "../../../../../lib/format-date";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";

const PushKeyTableCard = ({
  pushKey,
  team,
}: {
  pushKey: ApplePushKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection title="Push notifications key">
    {pushKey === null ? (
      <EmptyBindingMessage message="No push key bound — bind one with the CLI." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Protected</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>
              <CopyableMono value={pushKey.keyId} label="Key ID" />
            </TableCell>
            <TableCell>
              <TeamCell team={team} />
            </TableCell>
            <TableCell>
              <ProtectedBadgeCell isProtected={pushKey.protected} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(pushKey.createdAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CredentialSection>
);

const AscKeyTableCard = ({
  ascKey,
  team,
}: {
  ascKey: AscApiKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection title="App Store Connect API key">
    {ascKey === null ? (
      <EmptyBindingMessage message="No App Store Connect API key bound — bind one with the CLI." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Key ID</TableHead>
            <TableHead>Issuer ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Protected</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{ascKey.name}</TableCell>
            <TableCell>
              <CopyableMono value={ascKey.keyId} label="Key ID" />
            </TableCell>
            <TableCell>
              <CopyableMono value={ascKey.issuerId} label="Issuer ID" />
            </TableCell>
            <TableCell>
              <TeamCell team={team} />
            </TableCell>
            <TableCell>
              <ProtectedBadgeCell isProtected={ascKey.protected} />
            </TableCell>
            <TableCell>
              <RolesCell roles={ascKey.roles} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(ascKey.createdAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CredentialSection>
);

const findPushKey = (
  items: readonly ApplePushKeyItem[],
  id: string | null,
): ApplePushKeyItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((key) => key.id === id);
  return found === undefined ? null : found;
};

const findAscKey = (items: readonly AscApiKeyItem[], id: string | null): AscApiKeyItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((key) => key.id === id);
  return found === undefined ? null : found;
};

const findTeam = (items: readonly AppleTeamItem[], id: string): AppleTeamItem | null => {
  const found = items.find((team) => team.id === id);
  return found === undefined ? null : found;
};

export const IosServiceCredentialsSection = ({
  orgId,
  projectId,
  bundleIdentifier,
}: {
  orgId: string;
  projectId: string;
  bundleIdentifier: string;
}) => {
  const { data: configsResult } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const { data: pushKeysResult } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { data: ascKeysResult } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teamsResult } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  const firstConfig = configsResult.items.find(
    (config) => config.bundleIdentifier === bundleIdentifier,
  );

  if (firstConfig === undefined) {
    return null;
  }

  const pushKey = findPushKey(pushKeysResult.items, firstConfig.applePushKeyId);
  const ascKey = findAscKey(ascKeysResult.items, firstConfig.ascApiKeyId);
  // Push and ASC keys can belong to a different Apple Team than the bundle's
  // signing team, so each key resolves its own team.
  const pushTeam = pushKey === null ? null : findTeam(teamsResult.items, pushKey.appleTeamId);
  const ascTeam = ascKey?.appleTeamId ? findTeam(teamsResult.items, ascKey.appleTeamId) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
        <p className="text-muted-foreground text-sm">
          Push notification key and App Store Connect API key for this bundle identifier.
        </p>
      </div>
      <PushKeyTableCard pushKey={pushKey} team={pushTeam} />
      <AscKeyTableCard ascKey={ascKey} team={ascTeam} />
    </section>
  );
};
