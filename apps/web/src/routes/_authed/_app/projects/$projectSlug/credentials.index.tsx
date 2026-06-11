import {
  androidApplicationIdentifiersQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { Suspense } from "react";

import type {
  AndroidApplicationIdentifierItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { AndroidIcon } from "../../../../../components/android-icon";
import { AppleIcon } from "../../../../../components/apple-icon";
import { SectionHeader } from "../../../../../components/page-header";

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
  <Frame>
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
  </Frame>
);

const AndroidEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AndroidIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No application identifiers</EmptyTitle>
        <EmptyDescription>
          Use the CLI to register an Android application identifier and bind upload keystores and
          Google service account keys for this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const IosEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AppleIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No bundle identifiers</EmptyTitle>
        <EmptyDescription>
          Use the CLI to register an iOS bundle identifier and bind distribution certificates,
          provisioning profiles, push keys, and App Store Connect API keys for this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const ROW_CLASS =
  "hover:bg-muted/50 flex items-center justify-between gap-2 px-3 py-3 font-mono text-sm transition-colors";

const AndroidIdentifierRow = ({
  projectSlug,
  item,
}: {
  readonly projectSlug: string;
  readonly item: AndroidApplicationIdentifierItem;
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
  </TableRow>
);

const IosIdentifierRow = ({
  projectSlug,
  group,
}: {
  readonly projectSlug: string;
  readonly group: IosBundleGroup;
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
            {targetName ? <Badge variant="secondary">{targetName}</Badge> : null}
            {parent ? (
              <Badge variant="outline">
                ext of <span className="ml-1">{parent}</span>
              </Badge>
            ) : null}
          </span>
          <ChevronRightIcon strokeWidth={2} className="text-muted-foreground size-4" />
        </Link>
      </TableCell>
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
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
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
      />
      {items.length === 0 ? (
        <AndroidEmpty />
      ) : (
        <Frame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Application identifier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <AndroidIdentifierRow key={item.id} projectSlug={projectSlug} item={item} />
              ))}
            </TableBody>
          </Table>
        </Frame>
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
  const { data } = useSuspenseQuery(iosBundleConfigurationsQueryOptions(orgId, projectId));
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
      />
      {groups.length === 0 ? (
        <IosEmpty />
      ) : (
        <Frame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Bundle identifier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <IosIdentifierRow
                  key={group.bundleIdentifier}
                  projectSlug={projectSlug}
                  group={group}
                />
              ))}
            </TableBody>
          </Table>
        </Frame>
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
