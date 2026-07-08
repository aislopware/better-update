import { fingerprintDetailQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup } from "@better-update/ui/components/ui/item";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon, PackageIcon } from "lucide-react";
import { Suspense } from "react";

import type { BuildWithArtifact, Update } from "@better-update/api";

import { DistributionBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { PageHeader } from "../../../../../../components/page-header";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { CopyButton } from "../../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../../lib/relative-time";

interface RouteParams {
  projectSlug: string;
  hash: string;
}

type BuildItem = BuildWithArtifact;
type UpdateItem = Update;

const FingerprintEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No builds or updates yet</EmptyTitle>
        <EmptyDescription>
          Nothing in this project has been published with this fingerprint yet.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const FingerprintHashCard = ({
  hash,
  buildCount,
  updateCount,
}: {
  hash: string;
  buildCount: number;
  updateCount: number;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <FingerprintIcon strokeWidth={2} className="text-muted-foreground size-5" />
        Fingerprint
      </CardTitle>
      <CardDescription>
        Native + JS surface hash. Builds and updates with this hash are runtime-compatible.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-xl p-3 font-mono text-xs">
          {hash}
        </pre>
        <CopyButton value={hash} label="Fingerprint" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{buildCount} builds</Badge>
        <Badge variant="secondary">{updateCount} updates</Badge>
      </div>
    </CardContent>
  </Card>
);

const FingerprintBuildsCard = ({
  projectSlug,
  builds,
}: {
  projectSlug: string;
  builds: readonly BuildItem[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Builds ({builds.length})</CardTitle>
      <CardDescription>Binaries produced against this fingerprint.</CardDescription>
    </CardHeader>
    <CardContent>
      {builds.length === 0 ? (
        <p className="text-muted-foreground text-sm">No builds carry this fingerprint.</p>
      ) : (
        <ItemGroup>
          {builds.map((build) => (
            <Item
              key={build.id}
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/projects/$projectSlug/builds/$buildId"
                  params={{ projectSlug, buildId: build.id }}
                />
              }
            >
              <ItemContent className="flex-row flex-wrap items-center gap-2">
                <PlatformBadge platform={build.platform} />
                <DistributionBadge distribution={build.distribution} />
                <span className="font-medium">v{build.runtimeVersion ?? "—"}</span>
                <span className="text-muted-foreground text-sm">{build.profile}</span>
              </ItemContent>
              <ItemActions>
                <RelativeTime value={build.createdAt} className="text-muted-foreground text-xs" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </CardContent>
  </Card>
);

const FingerprintUpdatesCard = ({
  projectSlug,
  updates,
}: {
  projectSlug: string;
  updates: readonly UpdateItem[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Updates ({updates.length})</CardTitle>
      <CardDescription>OTA updates published against this fingerprint.</CardDescription>
    </CardHeader>
    <CardContent>
      {updates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No updates carry this fingerprint.</p>
      ) : (
        <ItemGroup>
          {updates.map((update) => (
            <Item
              key={update.id}
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/projects/$projectSlug/updates/$updateId"
                  params={{ projectSlug, updateId: update.id }}
                />
              }
            >
              <ItemContent className="flex-row flex-wrap items-center gap-2">
                <PlatformBadge platform={update.platform} />
                <span className="font-medium">v{update.runtimeVersion}</span>
                {update.isRollback && <Badge variant="destructive">Rollback</Badge>}
                <span className="text-muted-foreground line-clamp-1 text-sm">
                  {update.message || `Update ${update.groupId.slice(0, 8)}`}
                </span>
              </ItemContent>
              <ItemActions>
                <RelativeTime value={update.createdAt} className="text-muted-foreground text-xs" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </CardContent>
  </Card>
);

const FingerprintContent = ({ projectSlug, hash }: RouteParams) => {
  const { activeOrg, project } = Route.useRouteContext();
  const { data } = useSuspenseQuery(fingerprintDetailQueryOptions(activeOrg.id, project.id, hash));

  if (data.builds.length === 0 && data.updates.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Fingerprint" />
        <FingerprintEmpty />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader size="sub" title="Fingerprint" />
      <FingerprintHashCard
        hash={data.hash}
        buildCount={data.builds.length}
        updateCount={data.updates.length}
      />
      <FingerprintBuildsCard projectSlug={projectSlug} builds={data.builds} />
      <FingerprintUpdatesCard projectSlug={projectSlug} updates={data.updates} />
    </div>
  );
};

const FingerprintSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <PageHeader size="sub" title="Fingerprint" />
    <DetailCardSkeleton rows={2} columns={1} />
    <DetailCardSkeleton rows={3} columns={1} />
    <DetailCardSkeleton rows={3} columns={1} />
  </div>
);

const FingerprintPage = () => {
  const { projectSlug, hash } = Route.useParams();
  return (
    <Suspense fallback={<FingerprintSkeleton />}>
      <FingerprintContent projectSlug={projectSlug} hash={hash} />
    </Suspense>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/fingerprints/$hash")({
  component: FingerprintPage,
});
