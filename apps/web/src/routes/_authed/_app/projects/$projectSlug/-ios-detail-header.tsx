import { iosBundleConfigurationsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { useSuspenseQuery } from "@tanstack/react-query";

import { AppleIcon } from "../../../../../components/apple-icon";
import { DetailHeader, DetailNotFound } from "../../../../../components/detail-header";
import { RouterLinkButton } from "../../../../../lib/router-link-button";
import { DISTRIBUTION_LABELS } from "./-ios-detail-shared";

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
  const configs = configsResult.items.filter(
    (config) => config.bundleIdentifier === bundleIdentifier,
  );
  const parentBundle = configs.find(
    (config) => config.parentBundleIdentifier !== null && config.parentBundleIdentifier !== "",
  )?.parentBundleIdentifier;
  const targetName = configs.find(
    (config) => config.targetName !== null && config.targetName !== "",
  )?.targetName;

  return (
    <DetailHeader
      title={<span className="font-mono">{bundleIdentifier}</span>}
      meta={
        <>
          <span className="inline-flex items-center gap-1.5">
            <AppleIcon className="size-3.5" />
            Bundle Identifier
          </span>
          {targetName ? <Badge variant="secondary">Target: {targetName}</Badge> : null}
          {parentBundle ? (
            <Badge variant="outline">
              Extension of <InlineCode className="ml-1">{parentBundle}</InlineCode>
            </Badge>
          ) : null}
          {configs.map((config) => (
            <Badge key={config.id} variant="outline">
              {DISTRIBUTION_LABELS[config.distributionType]}
            </Badge>
          ))}
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
