import {
  deleteIosBundleConfiguration,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
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
  CardFrameAction,
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
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { AppleIcon } from "../../../../../components/apple-icon";
import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleDelete = async () => {
    await Promise.all(configs.map(async (config) => deleteIosBundleConfiguration(config.id)));
  };
  const handleSuccess = async () => {
    await queryClient.invalidateQueries({
      queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
    });
    await navigate({
      to: "/projects/$projectSlug/credentials",
      params: { projectSlug },
    });
  };

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
                {targetName === undefined || targetName === null ? null : (
                  <Badge variant="secondary">Target: {targetName}</Badge>
                )}
                {parentBundle === undefined || parentBundle === null ? null : (
                  <Badge variant="outline">
                    Extension of <span className="ml-1 font-mono">{parentBundle}</span>
                  </Badge>
                )}
                {configs.map((config) => (
                  <Badge key={config.id} variant="outline">
                    {DISTRIBUTION_LABELS[config.distributionType]}
                  </Badge>
                ))}
              </span>
            )}
          </CardFrameDescription>
          {configs.length === 0 ? null : (
            <CardFrameAction>
              <Button
                variant="destructive-outline"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <Trash2Icon strokeWidth={2} data-icon="inline-start" />
                Delete bundle configuration
              </Button>
            </CardFrameAction>
          )}
        </CardFrameHeader>
      </CardFrame>
      <ConfirmDeleteDialog
        name={bundleIdentifier}
        title="Delete bundle configuration?"
        description={`Removes ${String(configs.length)} distribution-type configuration(s) for this bundle identifier. Org-level certificates, profiles, push keys, and ASC keys are not deleted.`}
        onConfirm={handleDelete}
        successMessage="Bundle configuration deleted"
        onSuccess={handleSuccess}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
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
