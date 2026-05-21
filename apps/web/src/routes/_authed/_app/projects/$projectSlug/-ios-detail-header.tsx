import { iosBundleConfigurationsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@better-update/ui/components/ui/breadcrumb";
import { Button } from "@better-update/ui/components/ui/button";
import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { AppleIcon } from "../../../../../components/apple-icon";
import { DISTRIBUTION_LABELS } from "./-ios-detail-shared";

export const IosDetailHeader = ({
  orgId,
  projectId,
  projectSlug,
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
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <Link
                  to="/projects/$projectSlug/credentials"
                  params={{ projectSlug }}
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              Credentials
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono">{bundleIdentifier}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <CardFrame>
        <CardFrameHeader className="py-5">
          <CardFrameTitle className="flex items-center gap-2.5 text-base">
            <AppleIcon className="size-5" />
            <span className="font-mono">{bundleIdentifier}</span>
          </CardFrameTitle>
          <CardFrameDescription>
            {configs.length === 0 ? (
              "Bundle Identifier"
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                <span>Bundle Identifier</span>
                {targetName ? <Badge variant="secondary">Target: {targetName}</Badge> : null}
                {parentBundle ? (
                  <Badge variant="outline">
                    Extension of <span className="ml-1 font-mono">{parentBundle}</span>
                  </Badge>
                ) : null}
                {configs.map((config) => (
                  <Badge key={config.id} variant="outline">
                    {DISTRIBUTION_LABELS[config.distributionType]}
                  </Badge>
                ))}
              </span>
            )}
          </CardFrameDescription>
        </CardFrameHeader>
      </CardFrame>
    </div>
  );
};

export const IosNotFoundEmpty = ({
  projectSlug,
  bundleIdentifier,
}: {
  projectSlug: string;
  bundleIdentifier: string;
}) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <AppleIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>Bundle identifier not found</EmptyTitle>
      <EmptyDescription>
        No configuration exists for{" "}
        <code className="text-foreground font-mono">{bundleIdentifier}</code> on this project.
      </EmptyDescription>
    </EmptyHeader>
    <Button
      variant="outline"
      render={
        <Link to="/projects/$projectSlug/credentials" params={{ projectSlug }}>
          Back to credentials
        </Link>
      }
    />
  </Empty>
);
