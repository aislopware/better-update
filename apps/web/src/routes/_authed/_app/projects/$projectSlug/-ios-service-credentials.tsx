import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";

import type {
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
} from "@better-update/api-client/react";

import { ProtectedMark, RolesCell, TeamCell } from "../../-credential-cells";
import { DetailStat, DetailStatStrip } from "../../../../../components/detail-stats";
import { CopyableMono } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";

const PushKeyCard = ({
  pushKey,
  team,
}: {
  pushKey: ApplePushKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection
    title="Push notifications key"
    badges={pushKey ? <ProtectedMark isProtected={pushKey.protected} /> : undefined}
  >
    {pushKey === null ? (
      <EmptyBindingMessage message="No push key bound — bind one with the CLI." />
    ) : (
      <DetailStatStrip columns={3}>
        <DetailStat label="Key ID">
          <CopyableMono value={pushKey.keyId} label="Key ID" />
        </DetailStat>
        {team ? (
          <DetailStat label="Apple Team">
            <TeamCell team={team} />
          </DetailStat>
        ) : null}
        <DetailStat label="Uploaded">
          <span className="text-kumo-subtle">
            <RelativeTime value={pushKey.createdAt} />
          </span>
        </DetailStat>
      </DetailStatStrip>
    )}
  </CredentialSection>
);

const AscKeyCard = ({
  ascKey,
  team,
}: {
  ascKey: AscApiKeyItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection
    title="App Store Connect API key"
    badges={ascKey ? <ProtectedMark isProtected={ascKey.protected} /> : undefined}
  >
    {ascKey === null ? (
      <EmptyBindingMessage message="No App Store Connect API key bound — bind one with the CLI." />
    ) : (
      <DetailStatStrip columns={3}>
        <DetailStat label="Label">
          <span className="truncate font-medium">{ascKey.name}</span>
        </DetailStat>
        <DetailStat label="Key ID">
          <CopyableMono value={ascKey.keyId} label="Key ID" />
        </DetailStat>
        <DetailStat label="Issuer ID">
          <CopyableMono value={ascKey.issuerId} label="Issuer ID" />
        </DetailStat>
        {team ? (
          <DetailStat label="Apple Team">
            <TeamCell team={team} />
          </DetailStat>
        ) : null}
        <DetailStat label="Roles">
          <RolesCell roles={ascKey.roles} />
        </DetailStat>
        <DetailStat label="Uploaded">
          <span className="text-kumo-subtle">
            <RelativeTime value={ascKey.createdAt} />
          </span>
        </DetailStat>
      </DetailStatStrip>
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
  // …so it is named only when it is not the team the page header already gave.
  const bundleTeamId = firstConfig.appleTeamId;
  const pushTeam =
    pushKey === null || pushKey.appleTeamId === bundleTeamId
      ? null
      : findTeam(teamsResult.items, pushKey.appleTeamId);
  const ascTeam =
    ascKey?.appleTeamId && ascKey.appleTeamId !== bundleTeamId
      ? findTeam(teamsResult.items, ascKey.appleTeamId)
      : null;

  return (
    <section className="flex flex-col gap-4">
      {/* The sentence here listed the two panels under it by name — the page
          is already scoped to this bundle identifier by its own header. */}
      <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
      <PushKeyCard pushKey={pushKey} team={pushTeam} />
      <AscKeyCard ascKey={ascKey} team={ascTeam} />
    </section>
  );
};
