import {
  androidApplicationIdentifiersQueryOptions,
  deleteAndroidApplicationIdentifier,
} from "@better-update/api-client/react";
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

import { AndroidIcon } from "../../../../../components/android-icon";
import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

export const AndroidDetailHeader = ({
  orgId,
  projectId,
  projectSlug,
  packageName,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
  packageName: string;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: identifiersResult } = useSuspenseQuery(
    androidApplicationIdentifiersQueryOptions(orgId, projectId),
  );
  const identifier = identifiersResult.items.find((item) => item.packageName === packageName);

  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleDelete = async () => {
    if (identifier === undefined) {
      return;
    }
    await deleteAndroidApplicationIdentifier(identifier.id);
  };
  const handleSuccess = async () => {
    await queryClient.invalidateQueries({
      queryKey: androidApplicationIdentifiersQueryOptions(orgId, projectId).queryKey,
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
            <BreadcrumbPage className="font-mono">{packageName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <CardFrame>
        <CardFrameHeader className="py-5">
          <CardFrameTitle className="flex items-center gap-2.5 text-base">
            <AndroidIcon className="size-5" />
            <span className="font-mono">{packageName}</span>
          </CardFrameTitle>
          <CardFrameDescription>Application Identifier</CardFrameDescription>
          {identifier === undefined ? null : (
            <CardFrameAction>
              <Button
                variant="destructive-outline"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <Trash2Icon strokeWidth={2} data-icon="inline-start" />
                Delete application identifier
              </Button>
            </CardFrameAction>
          )}
        </CardFrameHeader>
      </CardFrame>
      <ConfirmDeleteDialog
        name={packageName}
        title="Delete application identifier?"
        description="Removes the identifier and all its credential group bindings. Org-level keystores and service account keys are not deleted."
        onConfirm={handleDelete}
        successMessage="Application identifier deleted"
        onSuccess={handleSuccess}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
};

export const AndroidNotFoundEmpty = ({
  projectSlug,
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <AndroidIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>Application identifier not found</EmptyTitle>
      <EmptyDescription>
        No identifier exists for <code className="text-foreground font-mono">{packageName}</code> on
        this project.
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
