import {
  androidApplicationIdentifiersQueryOptions,
  deleteAndroidApplicationIdentifier,
  deleteIosBundleConfiguration,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { CardFrame } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, Trash2Icon } from "lucide-react";
import { Suspense, useState } from "react";

import type {
  AndroidApplicationIdentifierItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { AndroidIcon } from "../../../../../components/android-icon";
import { AppleIcon } from "../../../../../components/apple-icon";
import { SectionHeader } from "../../../../../components/page-header";
import { AddAndroidApplicationIdentifierDialog } from "./-add-android-application-identifier-dialog";
import { AddIosBundleIdentifierDialog } from "./-add-ios-bundle-identifier-dialog";
import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

interface IosBundleGroup {
  readonly bundleIdentifier: string;
  readonly configs: readonly IosBundleConfigurationItem[];
}

const groupBundleConfigs = (
  items: readonly IosBundleConfigurationItem[],
): readonly IosBundleGroup[] => {
  const buckets = items.reduce<Map<string, IosBundleConfigurationItem[]>>((acc, config) => {
    const list = acc.get(config.bundleIdentifier) ?? [];
    acc.set(config.bundleIdentifier, [...list, config]);
    return acc;
  }, new Map());
  return Array.from(buckets, ([bundleIdentifier, configs]) => ({
    bundleIdentifier,
    configs,
  })).toSorted((left, right) => left.bundleIdentifier.localeCompare(right.bundleIdentifier));
};

const SectionListSkeleton = () => (
  <CardFrame>
    <Table variant="card">
      <TableBody>
        {[0, 1, 2].map((index) => (
          <TableRow key={index}>
            <TableCell>
              <Skeleton className="h-4 w-64 rounded" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </CardFrame>
);

const AndroidEmpty = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <AndroidIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>Create your first Application Identifier</EmptyTitle>
      <EmptyDescription>
        There are no credentials configured for your Android application. Create your first
        application identifier to manage upload keystores and Google service account keys for this
        project.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const IosEmpty = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <AppleIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>Create your first Bundle Identifier</EmptyTitle>
      <EmptyDescription>
        There are no credentials configured for your iOS application. Create your first bundle
        identifier to manage distribution certificates, provisioning profiles, push keys, and App
        Store Connect API keys for this project.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const ROW_CLASS =
  "hover:bg-muted/50 flex items-center justify-between gap-2 px-3 py-3 font-mono text-sm transition-colors";

const IdentifierActionsCell = ({
  identifier,
  onDelete,
  deleteTitle,
  deleteDescription,
  successMessage,
  onInvalidate,
}: {
  readonly identifier: string;
  readonly onDelete: () => Promise<unknown>;
  readonly deleteTitle: string;
  readonly deleteDescription: string;
  readonly successMessage: string;
  readonly onInvalidate: () => Promise<void>;
}) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <TableCell className="w-12 text-right">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${identifier}`}
        onClick={() => {
          setDeleteOpen(true);
        }}
      >
        <Trash2Icon strokeWidth={2} />
      </Button>
      <ConfirmDeleteDialog
        name={identifier}
        title={deleteTitle}
        description={deleteDescription}
        onConfirm={onDelete}
        successMessage={successMessage}
        onSuccess={onInvalidate}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </TableCell>
  );
};

const AndroidIdentifierRow = ({
  projectSlug,
  item,
  onDelete,
  onInvalidate,
}: {
  readonly projectSlug: string;
  readonly item: AndroidApplicationIdentifierItem;
  readonly onDelete: () => Promise<unknown>;
  readonly onInvalidate: () => Promise<void>;
}) => (
  <TableRow>
    <TableCell className="p-0">
      <Link
        to="/projects/$projectSlug/credentials/android/$packageName"
        params={{ projectSlug, packageName: item.packageName }}
        className={ROW_CLASS}
      >
        <span>{item.packageName}</span>
        <ChevronRightIcon strokeWidth={2} className="text-muted-foreground size-4" />
      </Link>
    </TableCell>
    <IdentifierActionsCell
      identifier={item.packageName}
      onDelete={onDelete}
      deleteTitle="Delete application identifier?"
      deleteDescription="This removes the identifier and all its credential group bindings. Org-level keystores and service account keys are not deleted."
      successMessage="Application identifier deleted"
      onInvalidate={onInvalidate}
    />
  </TableRow>
);

const IosIdentifierRow = ({
  projectSlug,
  group,
  onDelete,
  onInvalidate,
}: {
  readonly projectSlug: string;
  readonly group: IosBundleGroup;
  readonly onDelete: () => Promise<unknown>;
  readonly onInvalidate: () => Promise<void>;
}) => {
  const parent = group.configs.find(
    (config) => config.parentBundleIdentifier !== null && config.parentBundleIdentifier !== "",
  )?.parentBundleIdentifier;
  const targetName = group.configs.find(
    (config) => config.targetName !== null && config.targetName !== "",
  )?.targetName;
  return (
    <TableRow>
      <TableCell className="p-0">
        <Link
          to="/projects/$projectSlug/credentials/ios/$bundleIdentifier"
          params={{ projectSlug, bundleIdentifier: group.bundleIdentifier }}
          className={ROW_CLASS}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>{group.bundleIdentifier}</span>
            {targetName === undefined || targetName === null ? null : (
              <Badge variant="secondary">{targetName}</Badge>
            )}
            {parent === undefined || parent === null ? null : (
              <Badge variant="outline">
                ext of <span className="ml-1">{parent}</span>
              </Badge>
            )}
          </span>
          <ChevronRightIcon strokeWidth={2} className="text-muted-foreground size-4" />
        </Link>
      </TableCell>
      <IdentifierActionsCell
        identifier={group.bundleIdentifier}
        onDelete={onDelete}
        deleteTitle="Delete bundle configuration?"
        deleteDescription={`Removes ${String(group.configs.length)} distribution-type configuration(s) for this bundle identifier. Org-level certificates and push keys are not deleted.`}
        successMessage="Bundle configuration deleted"
        onInvalidate={onInvalidate}
      />
    </TableRow>
  );
};

const AndroidSection = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: androidApplicationIdentifiersQueryOptions(orgId, projectId).queryKey,
    });
  };
  const { items } = data;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <AndroidIcon strokeWidth={2} className="size-4" />
            Android
          </span>
        }
        actions={
          <AddAndroidApplicationIdentifierDialog
            orgId={orgId}
            projectId={projectId}
            onCreated={invalidate}
          />
        }
      />
      {items.length === 0 ? (
        <AndroidEmpty />
      ) : (
        <CardFrame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Application identifier</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <AndroidIdentifierRow
                  key={item.id}
                  projectSlug={projectSlug}
                  item={item}
                  onDelete={async () => deleteAndroidApplicationIdentifier(item.id)}
                  onInvalidate={invalidate}
                />
              ))}
            </TableBody>
          </Table>
        </CardFrame>
      )}
    </section>
  );
};

const IosSection = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(iosBundleConfigurationsQueryOptions(orgId, projectId));
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
    });
  };
  const { items } = data;
  const groups = groupBundleConfigs(items);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <AppleIcon strokeWidth={2} className="size-4" />
            iOS
          </span>
        }
        actions={
          <AddIosBundleIdentifierDialog
            orgId={orgId}
            projectId={projectId}
            onCreated={invalidate}
          />
        }
      />
      {groups.length === 0 ? (
        <IosEmpty />
      ) : (
        <CardFrame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Bundle identifier</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <IosIdentifierRow
                  key={group.bundleIdentifier}
                  projectSlug={projectSlug}
                  group={group}
                  onDelete={async () => {
                    await Promise.all(
                      group.configs.map(async (config) => deleteIosBundleConfiguration(config.id)),
                    );
                  }}
                  onInvalidate={invalidate}
                />
              ))}
            </TableBody>
          </Table>
        </CardFrame>
      )}
    </section>
  );
};

const ProjectCredentialsIndex = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  return (
    <div className="flex w-full flex-col gap-8">
      <Suspense fallback={<SectionListSkeleton />}>
        <AndroidSection orgId={activeOrg.id} projectId={project.id} projectSlug={projectSlug} />
      </Suspense>
      <Suspense fallback={<SectionListSkeleton />}>
        <IosSection orgId={activeOrg.id} projectId={project.id} projectSlug={projectSlug} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/credentials/")({
  component: ProjectCredentialsIndex,
});
