import {
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { useSuspenseQuery } from "@tanstack/react-query";

import { AppleIcon } from "../../../../../components/apple-icon";
import { DetailHeader, DetailNotFound } from "../../../../../components/detail-header";
import { RouterLinkButton } from "../../../../../lib/router-link-button";
import { sharedAppleTeamId } from "./-ios-detail-shared";

// `projectSlug` stays in the props type for the caller; the shell breadcrumb
// now covers the route, so the header itself no longer links back.
export const IosDetailHeader = ({
  orgId,
  projectId,
  bundleIdentifier,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
  bundleIdentifier: string;
}) => {
  const { data: configsResult } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const configs = configsResult.items.filter(
    (config) => config.bundleIdentifier === bundleIdentifier,
  );
  const parentBundle = configs.find(
    (config) => config.parentBundleIdentifier !== null && config.parentBundleIdentifier !== "",
  )?.parentBundleIdentifier;
  const targetName = configs.find(
    (config) => config.targetName !== null && config.targetName !== "",
  )?.targetName;
  const teamId = sharedAppleTeamId(configs);
  const team = teamId === null ? undefined : teams.items.find((item) => item.id === teamId);

  return (
    <DetailHeader
      title={<span className="font-mono">{bundleIdentifier}</span>}
      meta={
        <>
          {/* The team the tables below all sign with, said once here instead of
              in a column of every one of them. The distributions moved out too —
              the tab strip under this header is the list of them. */}
          {team ? (
            <span className="inline-flex items-center gap-1.5">
              <AppleIcon className="size-3.5" />
              {team.name ?? team.appleTeamId}
              <span className="font-mono text-xs">{team.appleTeamId}</span>
            </span>
          ) : null}
          {targetName ? <Badge variant="secondary">Target: {targetName}</Badge> : null}
          {parentBundle ? (
            <Badge variant="outline">
              Extension of <InlineCode className="ml-1">{parentBundle}</InlineCode>
            </Badge>
          ) : null}
        </>
      }
    />
  );
};

export const IosNotFoundEmpty = ({
  projectSlug,
  bundleIdentifier,
}: {
  projectSlug: string;
  bundleIdentifier: string;
}) => (
  <DetailNotFound
    icon={<AppleIcon />}
    title="Bundle identifier not found"
    description={`No configuration exists for ${bundleIdentifier} on this project.`}
    backLink={
      <RouterLinkButton to="/projects/$projectSlug/credentials" params={{ projectSlug }}>
        Back to credentials
      </RouterLinkButton>
    }
  />
);
