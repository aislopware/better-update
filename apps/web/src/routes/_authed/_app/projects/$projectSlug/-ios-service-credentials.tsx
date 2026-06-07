import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import {
  Card,
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@better-update/ui/components/ui/card";
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

import { RolesCell, TeamCell } from "../../-credential-cells";
import { formatShortDate } from "../../../../../lib/format-date";

const EmptyBindingCard = ({ message }: { message: string }) => (
  <Card>
    <CardPanel className="py-4">
      <span className="text-muted-foreground text-sm">{message}</span>
    </CardPanel>
  </Card>
);

const PushKeyTableCard = ({
  pushKey,
  team,
}: {
  pushKey: ApplePushKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Push notifications key</CardFrameTitle>
    </CardFrameHeader>
    {pushKey === null ? (
      <EmptyBindingCard message="No push key bound — bind one with the CLI." />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono">{pushKey.keyId}</TableCell>
            <TableCell>
              <TeamCell team={team} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDate(pushKey.createdAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

const AscKeyTableCard = ({
  ascKey,
  team,
}: {
  ascKey: AscApiKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">App Store Connect API key</CardFrameTitle>
    </CardFrameHeader>
    {ascKey === null ? (
      <EmptyBindingCard message="No App Store Connect API key bound — bind one with the CLI." />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Key ID</TableHead>
            <TableHead>Issuer ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{ascKey.name}</TableCell>
            <TableCell className="font-mono">{ascKey.keyId}</TableCell>
            <TableCell className="font-mono text-xs break-all">{ascKey.issuerId}</TableCell>
            <TableCell>
              <TeamCell team={team} />
            </TableCell>
            <TableCell>
              <RolesCell roles={ascKey.roles} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDate(ascKey.createdAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CardFrame>
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
  const team = findTeam(teamsResult.items, firstConfig.appleTeamId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
        <p className="text-muted-foreground text-sm">
          Push notification key and App Store Connect API key for this bundle identifier.
        </p>
      </div>
      <PushKeyTableCard pushKey={pushKey} team={team} />
      <AscKeyTableCard ascKey={ascKey} team={team} />
    </section>
  );
};
